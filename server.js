import dotenv from "dotenv"
import express from "express"
import morgan from "morgan"
import path from "path"
import fs from "fs"
import http from "http"
import https from "https"

import { errorHandler, notFound } from "./app/middleware/error.middleware.js"
import { prisma } from "./app/prisma.js"

import authRoutes from "./app/auth/auth.routes.js"
import userRoutes from "./app/user/user.routes.js"
import configRoutes from "./app/config/config.routes.js"
// Генератор ресурсов (app/generate) из шаблона удалён: он написан под MongoDB,
// а на PostgreSQL опасен — POST /api/admin/generate/resource переписывал
// prisma/schema.prisma и выполнял `prisma db push --accept-data-loss`, то есть
// рассинхронизировал историю миграций и мог снести данные «Маяка».
import mediaRoutes from "./app/media/media.routes.js"
import { INLINE_SAFE_EXTENSIONS, uploadsDir } from "./app/media/media.controller.js"
import leadRoutes from "./app/lead/lead.routes.js"
import productRoutes from "./app/product/product.routes.js"
import articleRoutes from "./app/article/article.routes.js"
import solutionRoutes from "./app/solution/solution.routes.js"
import settingRoutes from "./app/setting/setting.routes.js"
import faqRoutes from "./app/faq/faq.routes.js"

import cors from "cors"

dotenv.config()

const app = express()

// 3199 — порт, на котором сайт «Маяк» крутится в dev (next dev).
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3199',
  'http://127.0.0.1:3199',
  'http://localhost:5173',
]

const extraCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// Настройка CORS для работы с фронтендом
app.use(cors({
  origin: [...new Set([...DEFAULT_CORS_ORIGINS, ...extraCorsOrigins])], // Разрешаем запросы с фронтенда
  credentials: true, // Разрешаем отправку cookies и авторизационных заголовков
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}))

// За обратным прокси (nginx) включите TRUST_PROXY=1, иначе в Lead.ip
// будет попадать адрес прокси, а не посетителя.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? true : process.env.TRUST_PROXY)
}

async function main() {
  const nodeEnv = process.env.NODE_ENV
  const isDevEnv = nodeEnv === "dev" || nodeEnv === "development"

  if (isDevEnv) app.use(morgan("dev"))

  // Лимит тела: JSON-статьи с секциями бывают крупными, но не мегабайтными.
  app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "1mb" }))

  const __dirname = path.resolve()

  // Загруженные файлы отдаются с того же origin, что и API, поэтому статика
  // подписана строгими заголовками: nosniff запрещает браузеру угадывать тип,
  // CSP + sandbox глушат исполнение, а всё, что не картинка, уходит вложением.
  app.use(
    "/uploads",
    express.static(uploadsDir, {
      index: false,
      dotfiles: "deny",
      setHeaders: (res, filePath) => {
        res.setHeader("X-Content-Type-Options", "nosniff")
        res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox")
        res.setHeader("Cross-Origin-Resource-Policy", "same-site")
        if (!INLINE_SAFE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
          res.setHeader("Content-Disposition", "attachment")
        }
      },
    })
  )
  app.use("/config.json", express.static(path.join(__dirname, "/public/config.json")))

  app.use("/api/auth", authRoutes)
  app.use("/api/users", userRoutes)
  app.use("/api/config", configRoutes)
  app.use("/api/admin/media", mediaRoutes)
  app.use("/api/media", mediaRoutes)

  // Контент сайта «Маяк»
  app.use("/api/leads", leadRoutes)
  app.use("/api/products", productRoutes)
  app.use("/api/articles", articleRoutes)
  app.use("/api/solutions", solutionRoutes)
  app.use("/api/settings", settingRoutes)
  app.use("/api/faq", faqRoutes)

  app.get("/api/health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      res.json({ status: "ok", db: "up", env: nodeEnv, time: new Date().toISOString() })
    } catch (error) {
      res.status(503).json({ status: "error", db: "down", message: error.message })
    }
  })

  app.use(notFound)
  app.use(errorHandler)

  const PORT = process.env.PORT || (nodeEnv === "production" ? 443 : 5000)

  let server
  let protocol = "http"
  const sslKeyPath = process.env.SSL_KEY_PATH
  const sslCertPath = process.env.SSL_CERT_PATH
  const hasSslPaths = Boolean(sslKeyPath && sslCertPath)

  // Штатный сценарий развёртывания: API слушает localhost по HTTP, а TLS держит
  // nginx перед ним. Тогда сертификаты самому приложению не нужны, и городить
  // второй TLS-терминатор незачем. Признак — BEHIND_PROXY=1 в окружении.
  // ВАЖНО: NODE_ENV при этом остаётся production, иначе errorHandler начнёт
  // отдавать наружу стек-трейсы.
  const behindProxy = process.env.BEHIND_PROXY === "1"

  if (nodeEnv === "production" && behindProxy && !hasSslPaths) {
    server = http.createServer(app)
  } else if (nodeEnv === "production") {
    if (!hasSslPaths) {
      throw new Error(
        "Для production укажите SSL_KEY_PATH и SSL_CERT_PATH — либо BEHIND_PROXY=1, если TLS держит обратный прокси",
      )
    }

    const resolvedSslKeyPath = path.resolve(sslKeyPath)
    const resolvedSslCertPath = path.resolve(sslCertPath)

    if (!fs.existsSync(resolvedSslKeyPath) || !fs.existsSync(resolvedSslCertPath)) {
      throw new Error("SSL_KEY_PATH или SSL_CERT_PATH указывают на несуществующие файлы")
    }

    protocol = "https"
    server = https.createServer(
      {
        key: fs.readFileSync(resolvedSslKeyPath),
        cert: fs.readFileSync(resolvedSslCertPath),
      },
      app
    )
  } else if (isDevEnv) {
    server = http.createServer(app)
  } else {
    throw new Error('NODE_ENV должен быть "production", "dev" или "development"')
  }

  // За обратным прокси слушаем только петлю: иначе API торчит в интернет
  // напрямую, в обход nginx со всеми его ограничениями и заголовками.
  const BIND_HOST = process.env.BIND_HOST || (behindProxy ? "127.0.0.1" : "0.0.0.0")

  server.listen(PORT, BIND_HOST, () => {
    console.log(`Server running in ${nodeEnv} on ${protocol}://${BIND_HOST}:${PORT}`)
  })

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log(`SIGTERM signal received: closing ${protocol.toUpperCase()} server`)
    server.close(async () => {
      await prisma.$disconnect()
      console.log(`${protocol.toUpperCase()} server closed`)
    })
  })

  process.on("SIGINT", async () => {
    console.log(`SIGINT signal received: closing ${protocol.toUpperCase()} server`)
    server.close(async () => {
      await prisma.$disconnect()
      console.log(`${protocol.toUpperCase()} server closed`)
      process.exit(0)
    })
  })
}

main().catch(async (e) => {
  console.error('❌ Критическая ошибка при запуске сервера:', e)
  await prisma.$disconnect()
  process.exit(1)
})

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
  // Не завершаем процесс, чтобы сервер продолжал работать
})

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error)
  // Не завершаем процесс, чтобы сервер продолжал работать
})
