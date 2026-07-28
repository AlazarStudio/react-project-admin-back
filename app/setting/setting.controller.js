import asyncHandler from "express-async-handler"

import { hasValidSiteApiKey } from "../middleware/api-key.middleware.js"
import { isAdmin } from "../middleware/auth.middleware.js"
import { prisma } from "../prisma.js"
import {
  badRequest,
  has,
  missingFields,
  nextSortOrder,
  parseSortOrder,
  requireBoolean,
  toStringArray,
  toTrimmedString,
} from "../utils/http.utils.js"

const ORDERED = { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }

/** Простые контактные поля: только обрезка пробелов, пусто -> null. */
const PLAIN_FIELDS = ["telegram", "max", "address"]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** chat_id: числовой (в т.ч. отрицательный, у каналов «-100…») либо @username. */
const CHAT_ID_RE = /^-?\d{1,32}$/
const CHAT_USERNAME_RE = /^@[A-Za-z0-9_]{4,32}$/
const isValidChatId = (value) => CHAT_ID_RE.test(value) || CHAT_USERNAME_RE.test(value)

/** Потолок числа получателей уведомлений и длины подписи. */
const MAX_LEAD_CHATS = 20
const MAX_CHAT_LABEL = 80

/** Потолки для дополнительных запретов robots.txt. */
const MAX_ROBOTS_DISALLOW = 50
const MAX_ROBOTS_PATH = 200

/**
 * Необязательные поля со своим форматом.
 * Пустая строка везде означает «не задано» и сохраняется как null, а не "" —
 * иначе фронту пришлось бы отличать «пусто» от «пустая строка».
 */
const VALIDATED_FIELDS = {
  email: {
    max: 254,
    test: (value) => EMAIL_RE.test(value),
    message: '"email" must be a valid email address, e.g. "info@example.com"',
  },
  yandexMetrikaId: {
    max: 12,
    test: (value) => /^\d{1,12}$/.test(value),
    message: '"yandexMetrikaId" must contain only digits (up to 12), e.g. "98765432"',
  },
  googleAnalyticsId: {
    max: 20,
    // GA4 присылают и строчными — приводим к верхнему регистру сами.
    transform: (value) => value.toUpperCase(),
    test: (value) => /^G-[A-Z0-9]{4,18}$/.test(value),
    message:
      '"googleAnalyticsId" must look like "G-XXXXXXXXXX" (GA4 measurement ID). ' +
      'Universal Analytics ids like "UA-12345" are not supported',
  },
  // УСТАРЕЛО: одиночный получатель. Оставлен запасным вариантом, пока фронт
  // не перешёл на leadTelegramChats. Новый код должен писать в массив.
  leadTelegramChatId: {
    max: 64,
    // Именно строка: у групп id отрицательный и длинный, у каналов начинается
    // с -100. Форма @username тоже допустима.
    test: isValidChatId,
    message:
      '"leadTelegramChatId" must be a numeric chat id (e.g. "-1001234567890") ' +
      'or a "@username"',
  },
  leadEmail: {
    max: 254,
    test: (value) => EMAIL_RE.test(value),
    message: '"leadEmail" must be a valid email address, e.g. "zayavki@example.com"',
  },
}

/**
 * Список получателей уведомлений о заявке: [{ chatId, label }, …].
 *
 * Порядок значим. Дубликаты по chatId схлопываются — побеждает ПЕРВОЕ
 * вхождение вместе со своей подписью. Пустой массив допустим и означает
 * «в Telegram не уведомляем».
 *
 * Ради независимой выкатки фронта элемент-строка тоже принимается
 * и трактуется как { chatId, label: "" }.
 */
function normalizeLeadTelegramChats(value) {
  if (value === undefined || value === null) return []

  if (!Array.isArray(value)) {
    throw badRequest('"leadTelegramChats" must be an array of { chatId, label } objects')
  }

  const seen = new Set()
  const chats = []

  value.forEach((raw, index) => {
    const at = `leadTelegramChats[${index}]`

    let chatId
    let label

    if (typeof raw === "string") {
      chatId = raw.trim()
      label = ""
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      chatId = toTrimmedString(raw.chatId)
      label = toTrimmedString(raw.label)
    } else {
      throw badRequest(`"${at}" must be an object with "chatId" and "label"`)
    }

    if (!chatId) {
      throw badRequest(`"${at}.chatId" is required and must be a non-empty string`)
    }
    if (!isValidChatId(chatId)) {
      throw badRequest(
        `"${at}.chatId" must be a numeric chat id (e.g. "-1001234567890") or a "@username", ` +
          `got "${chatId}"`
      )
    }
    if (label.length > MAX_CHAT_LABEL) {
      throw badRequest(
        `"${at}.label" must be no longer than ${MAX_CHAT_LABEL} characters, got ${label.length}`
      )
    }

    if (seen.has(chatId)) return
    seen.add(chatId)
    chats.push({ chatId, label })
  })

  // Потолок считаем после схлопывания дублей: хранить будем именно столько.
  if (chats.length > MAX_LEAD_CHATS) {
    throw badRequest(
      `"leadTelegramChats" must contain no more than ${MAX_LEAD_CHATS} recipients, got ${chats.length}`
    )
  }

  return chats
}

/**
 * Дополнительные запрещённые пути robots.txt.
 *
 * Служебные запреты сайта (/api/, /admin, /konfigurator) сюда не попадают:
 * они зашиты в коде сайта, чтобы не зависеть от содержимого базы. Здесь
 * только то, что добавляет владелец.
 *
 * Пустые элементы отбрасываются (лишний перевод строки в textarea — не путь),
 * дубликаты схлопываются с сохранением первого вхождения и порядка.
 */
function normalizeRobotsDisallow(value) {
  if (value === undefined || value === null) return []

  // Принимаем и массив, и текст из textarea — по строке на путь.
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : null

  if (raw === null) {
    throw badRequest('"robotsDisallow" must be an array of paths')
  }

  const seen = new Set()
  const paths = []

  raw.forEach((item, index) => {
    if (typeof item !== "string") {
      throw badRequest(`"robotsDisallow[${index}]" must be a string`)
    }

    const path = item.trim()
    if (!path) return

    if (!path.startsWith("/")) {
      throw badRequest(
        `"robotsDisallow[${index}]" must start with "/" — got "${path}"`
      )
    }
    if (/\s/.test(path)) {
      throw badRequest(
        `"robotsDisallow[${index}]" must not contain whitespace — got "${path}"`
      )
    }
    if (path.length > MAX_ROBOTS_PATH) {
      throw badRequest(
        `"robotsDisallow[${index}]" must be no longer than ${MAX_ROBOTS_PATH} characters, got ${path.length}`
      )
    }

    if (seen.has(path)) return
    seen.add(path)
    paths.push(path)
  })

  // Потолок считаем после схлопывания дублей: хранить будем именно столько.
  if (paths.length > MAX_ROBOTS_DISALLOW) {
    throw badRequest(
      `"robotsDisallow" must contain no more than ${MAX_ROBOTS_DISALLOW} paths, got ${paths.length}`
    )
  }

  return paths
}

/**
 * Выключатель индексации.
 * Принимаем ТОЛЬКО настоящий boolean: строка "false" истинна в JS, и мягкое
 * приведение однажды открыло бы сайт поисковикам вопреки настройке.
 */
function normalizeRobotsIndexing(value) {
  return requireBoolean(value, "robotsIndexing")
}

/** Приводит значение поля настроек к хранимому виду или бросает 400. */
function normalizeSettingField(field, rawValue) {
  const value = toTrimmedString(rawValue)
  if (!value) return null

  const rule = VALIDATED_FIELDS[field]
  if (value.length > rule.max) {
    throw badRequest(`"${field}" must be no longer than ${rule.max} characters, got ${value.length}`)
  }

  const normalized = rule.transform ? rule.transform(value) : value
  if (!rule.test(normalized)) {
    throw badRequest(rule.message)
  }

  return normalized
}

/** SiteSetting — строго одна строка (в схеме гарантировано unique-полем). */
async function getOrCreateSettings() {
  const existing = await prisma.siteSetting.findFirst({ orderBy: { createdAt: "asc" } })
  if (existing) return existing

  return prisma.siteSetting.create({ data: { phones: [] } })
}

/**
 * Поля настроек, безопасные для анонимного чтения.
 *
 * Список именно БЕЛЫЙ, а не чёрный: при добавлении нового поля оно по
 * умолчанию НЕ попадает в публичный ответ, и очередная персональная настройка
 * не утечёт по забывчивости.
 *
 * Сюда сознательно не входят leadEmail, leadTelegramChats и устаревший
 * leadTelegramChatId: это персональные данные (адрес, куда падают заявки,
 * и chat_id сотрудников с подписями «кто это»).
 */
const PUBLIC_SETTING_FIELDS = [
  "id",
  "phones",
  "telegram",
  "max",
  "email",
  "address",
  "yandexMetrikaId",
  "googleAnalyticsId",
  "robotsIndexing",
  "robotsDisallow",
  "createdAt",
  "updatedAt",
]

function toPublicSettings(settings) {
  const result = {}
  for (const field of PUBLIC_SETTING_FIELDS) {
    if (field in settings) result[field] = settings[field]
  }
  return result
}

// @desc    Get site settings together with stats and process steps
// @route   GET /api/settings
// @access  Public — урезанный ответ; полный — админскому токену или сайту
//          по заголовку x-api-key (ему нужны получатели для доставки заявок)
export const getSettings = asyncHandler(async (req, res) => {
  const [settings, stats, process] = await Promise.all([
    getOrCreateSettings(),
    prisma.stat.findMany(ORDERED),
    prisma.processStep.findMany(ORDERED),
  ])

  const mayReadDelivery = isAdmin(req) || hasValidSiteApiKey(req)

  res.json({
    settings: mayReadDelivery ? settings : toPublicSettings(settings),
    stats,
    process,
  })
})

// @desc    Update site settings (контакты, аналитика, доставка заявок)
// @route   PUT /api/settings
// @access  Private (Admin)
export const updateSettings = asyncHandler(async (req, res) => {
  const current = await getOrCreateSettings()
  const data = {}

  // Обновляем ТОЛЬКО переданные ключи: частичный PUT не должен затирать
  // телефоны, контакты и счётчики, которые в этом запросе не участвуют.
  if (has(req.body, "phones")) data.phones = toStringArray(req.body.phones)

  for (const field of PLAIN_FIELDS) {
    if (has(req.body, field)) data[field] = toTrimmedString(req.body[field]) || null
  }

  for (const field of Object.keys(VALIDATED_FIELDS)) {
    if (has(req.body, field)) data[field] = normalizeSettingField(field, req.body[field])
  }

  if (has(req.body, "leadTelegramChats")) {
    data.leadTelegramChats = normalizeLeadTelegramChats(req.body.leadTelegramChats)
  }

  if (has(req.body, "robotsIndexing")) {
    data.robotsIndexing = normalizeRobotsIndexing(req.body.robotsIndexing)
  }

  if (has(req.body, "robotsDisallow")) {
    data.robotsDisallow = normalizeRobotsDisallow(req.body.robotsDisallow)
  }

  const settings = await prisma.siteSetting.update({ where: { id: current.id }, data })

  res.json(settings)
})

// ---------------------------------------------------------------------------
// STATS — «Цифры доверия»
// ---------------------------------------------------------------------------

// @desc    Get stats
// @route   GET /api/settings/stats
// @access  Public
export const getStats = asyncHandler(async (req, res) => {
  const items = await prisma.stat.findMany(ORDERED)
  res.json({ items })
})

// @desc    Create stat
// @route   POST /api/settings/stats
// @access  Private (Admin)
export const createStat = asyncHandler(async (req, res) => {
  const missing = missingFields(req.body, ["value", "label", "icon"])
  if (missing.length > 0) {
    throw badRequest(`Missing or empty required fields: ${missing.join(", ")}`)
  }

  const stat = await prisma.stat.create({
    data: {
      value: toTrimmedString(req.body.value),
      label: toTrimmedString(req.body.label),
      icon: toTrimmedString(req.body.icon),
      sortOrder: has(req.body, "sortOrder")
        ? parseSortOrder(req.body.sortOrder)
        : await nextSortOrder(prisma.stat),
    },
  })

  res.status(201).json(stat)
})

// @desc    Update stat
// @route   PUT /api/settings/stats/:id
// @access  Private (Admin)
export const updateStat = asyncHandler(async (req, res) => {
  const existing = await prisma.stat.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("Stat not found")
  }

  const data = {}
  for (const field of ["value", "label", "icon"]) {
    if (has(req.body, field)) {
      const value = toTrimmedString(req.body[field])
      if (!value) {
        throw badRequest(`Field "${field}" must be a non-empty string`)
      }
      data[field] = value
    }
  }
  if (has(req.body, "sortOrder")) data.sortOrder = parseSortOrder(req.body.sortOrder)

  const stat = await prisma.stat.update({ where: { id: existing.id }, data })

  res.json(stat)
})

// @desc    Delete stat
// @route   DELETE /api/settings/stats/:id
// @access  Private (Admin)
export const deleteStat = asyncHandler(async (req, res) => {
  const existing = await prisma.stat.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("Stat not found")
  }

  await prisma.stat.delete({ where: { id: existing.id } })

  res.json({ message: "Stat deleted successfully", id: existing.id })
})

// ---------------------------------------------------------------------------
// PROCESS — этапы «От задачи — до результата»
// ---------------------------------------------------------------------------

// @desc    Get process steps
// @route   GET /api/settings/process
// @access  Public
export const getProcessSteps = asyncHandler(async (req, res) => {
  const items = await prisma.processStep.findMany(ORDERED)
  res.json({ items })
})

// @desc    Create process step
// @route   POST /api/settings/process
// @access  Private (Admin)
export const createProcessStep = asyncHandler(async (req, res) => {
  const missing = missingFields(req.body, ["n", "title"])
  if (missing.length > 0) {
    throw badRequest(`Missing or empty required fields: ${missing.join(", ")}`)
  }

  const step = await prisma.processStep.create({
    data: {
      n: toTrimmedString(req.body.n),
      title: toTrimmedString(req.body.title),
      sortOrder: has(req.body, "sortOrder")
        ? parseSortOrder(req.body.sortOrder)
        : await nextSortOrder(prisma.processStep),
    },
  })

  res.status(201).json(step)
})

// @desc    Update process step
// @route   PUT /api/settings/process/:id
// @access  Private (Admin)
export const updateProcessStep = asyncHandler(async (req, res) => {
  const existing = await prisma.processStep.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("Process step not found")
  }

  const data = {}
  for (const field of ["n", "title"]) {
    if (has(req.body, field)) {
      const value = toTrimmedString(req.body[field])
      if (!value) {
        throw badRequest(`Field "${field}" must be a non-empty string`)
      }
      data[field] = value
    }
  }
  if (has(req.body, "sortOrder")) data.sortOrder = parseSortOrder(req.body.sortOrder)

  const step = await prisma.processStep.update({ where: { id: existing.id }, data })

  res.json(step)
})

// @desc    Delete process step
// @route   DELETE /api/settings/process/:id
// @access  Private (Admin)
export const deleteProcessStep = asyncHandler(async (req, res) => {
  const existing = await prisma.processStep.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("Process step not found")
  }

  await prisma.processStep.delete({ where: { id: existing.id } })

  res.json({ message: "Process step deleted successfully", id: existing.id })
})
