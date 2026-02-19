import dotenv from "dotenv"
import express from "express"
import morgan from "morgan"
import path from "path"

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
  if (process.env.NODE_ENV === "development") app.use(morgan("dev"))

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

  const PORT = process.env.PORT || 5000

  const server = app.listen(
    PORT,
    console.log(`Server running in ${process.env.NODE_ENV} on port ${PORT}`)
  )

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("SIGTERM signal received: closing HTTP server")
    server.close(async () => {
      await prisma.$disconnect()
      console.log("HTTP server closed")
    })
  })

  process.on("SIGINT", async () => {
    console.log("SIGINT signal received: closing HTTP server")
    server.close(async () => {
      await prisma.$disconnect()
      console.log("HTTP server closed")
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
