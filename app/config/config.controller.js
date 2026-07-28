import asyncHandler from "express-async-handler"
import axios from "axios"
import { prisma } from "../prisma.js"
import { badRequest } from "../utils/http.utils.js"

// @desc    Get backend configuration
// @route   GET /api/config
// @access  Public
export const getConfig = asyncHandler(async (req, res) => {
  const config = await prisma.config.findFirst({
    orderBy: {
      updatedAt: "desc"
    }
  })

  res.json({
    backendApiUrl: config?.backendApiUrl || null
  })
})

/** Разбирает http(s)-URL, отвергая всё остальное. */
function parseHttpUrl(value, field) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw badRequest(`${field} must be a valid URL`)
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badRequest(`${field} must use http or https`)
  }
  if (url.username || url.password) {
    throw badRequest(`${field} must not contain credentials`)
  }

  return url
}

/**
 * Хосты, которым разрешено отправлять обновление config.json.
 * Пусто (переменная не задана) — исходящий запрос не делается вовсе.
 */
function allowedSyncHosts() {
  return (process.env.CONFIG_SYNC_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Раньше сервер безусловно делал POST на переданный клиентом адрес —
 * классический SSRF: можно было заставить его стучаться во внутреннюю сеть
 * (169.254.169.254, localhost:*, соседние сервисы) и увидеть исход в логах.
 *
 * Теперь адрес обязан пройти allow-list хостов из CONFIG_SYNC_ALLOWED_HOSTS.
 * Если переменная не задана — синхронизация просто пропускается.
 */
async function syncFrontendConfig(frontendUrl, backendApiUrl) {
  if (!frontendUrl) {
    console.log("⚠️ frontendUrl не указан, пропускаю обновление config.json")
    return { synced: false, reason: "no_frontend_url" }
  }

  const allowed = allowedSyncHosts()
  if (allowed.length === 0) {
    console.log(
      "⚠️ CONFIG_SYNC_ALLOWED_HOSTS не задан — обновление config.json на фронтенде пропущено"
    )
    return { synced: false, reason: "sync_disabled" }
  }

  let url
  try {
    url = parseHttpUrl(frontendUrl, "frontendUrl")
  } catch {
    console.warn("⚠️ frontendUrl не является корректным http(s)-адресом, пропускаю синхронизацию")
    return { synced: false, reason: "invalid_frontend_url" }
  }

  if (!allowed.includes(url.hostname.toLowerCase())) {
    console.warn(
      `⚠️ Хост ${url.hostname} не входит в CONFIG_SYNC_ALLOWED_HOSTS — синхронизация отклонена`
    )
    return { synced: false, reason: "host_not_allowed" }
  }

  const endpoint = `${url.origin}${url.pathname.replace(/\/+$/, "")}/update-config.php`

  try {
    const response = await axios.post(
      endpoint,
      { backendApiUrl },
      {
        timeout: 5000,
        headers: { "Content-Type": "application/json" },
        // Редирект увёл бы запрос на произвольный хост в обход allow-list.
        maxRedirects: 0,
        validateStatus: (status) => status < 500,
      }
    )
    console.log("✅ config.json обновлен на фронтенде:", response.status)
    return { synced: true }
  } catch (error) {
    console.error("❌ Ошибка обновления config.json на фронтенде:", {
      message: error.message,
      status: error.response?.status,
      endpoint,
    })
    return { synced: false, reason: "request_failed" }
  }
}

// @desc    Save or update backend configuration
// @route   PUT /api/config
// @access  Private (Admin)
export const updateConfig = asyncHandler(async (req, res) => {
  const { backendApiUrl, frontendUrl } = req.body || {}

  if (!backendApiUrl || typeof backendApiUrl !== "string") {
    throw badRequest("backendApiUrl is required and must be a string")
  }

  const backendUrl = parseHttpUrl(backendApiUrl.trim(), "backendApiUrl")

  const data = { backendApiUrl: backendUrl.toString().replace(/\/+$/, "") }

  if (frontendUrl !== undefined) {
    if (typeof frontendUrl !== "string") {
      throw badRequest("frontendUrl must be a string")
    }
    if (frontendUrl.trim()) {
      data.frontendUrl = parseHttpUrl(frontendUrl.trim(), "frontendUrl").toString()
    }
  }

  const existingConfig = await prisma.config.findFirst({
    orderBy: { updatedAt: "desc" }
  })

  const config = existingConfig
    ? await prisma.config.update({ where: { id: existingConfig.id }, data })
    : await prisma.config.create({ data })

  const sync = await syncFrontendConfig(config.frontendUrl, config.backendApiUrl)

  res.json({
    success: true,
    sync,
    config: {
      id: config.id,
      backendApiUrl: config.backendApiUrl,
      frontendUrl: config.frontendUrl,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    }
  })
})
