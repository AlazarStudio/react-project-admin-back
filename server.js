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
import generateRoutes from "./app/generate/generate.routes.js"
import mediaRoutes from "./app/media/media.routes.js"

import cors from "cors"

dotenv.config()

const app = express()

// Настройка CORS для работы с фронтендом
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5173'], // Разрешаем запросы с фронтенда
  credentials: true, // Разрешаем отправку cookies и авторизационных заголовков
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

async function main() {
  const nodeEnv = process.env.NODE_ENV
  const isDevEnv = nodeEnv === "dev" || nodeEnv === "development"

  if (isDevEnv) app.use(morgan("dev"))

  app.use(express.json())

  const __dirname = path.resolve()

  app.use("/uploads", express.static(path.join(__dirname, "/uploads/")))
  app.use("/config.json", express.static(path.join(__dirname, "/public/config.json")))

  app.use("/api/auth", authRoutes)
  app.use("/api/users", userRoutes)
  app.use("/api/config", configRoutes)
  app.use("/api/admin", generateRoutes)
  app.use("/api/admin/media", mediaRoutes)

  app.use(notFound)
  app.use(errorHandler)

  const PORT = process.env.PORT || (nodeEnv === "production" ? 443 : 5000)

  let server
  let protocol = "http"
  const sslKeyPath = process.env.SSL_KEY_PATH
  const sslCertPath = process.env.SSL_CERT_PATH
  const hasSslPaths = Boolean(sslKeyPath && sslCertPath)

  if (nodeEnv === "production") {
    if (!hasSslPaths) {
      throw new Error("Для production (HTTPS) укажите SSL_KEY_PATH и SSL_CERT_PATH в .env")
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

  server.listen(PORT, () => {
    console.log(`Server running in ${nodeEnv} on ${protocol}://localhost:${PORT}`)
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
