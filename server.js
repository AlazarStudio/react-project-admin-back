import dotenv from "dotenv"
import express from "express"
import morgan from "morgan"
import path from "path"

import { errorHandler, notFound } from "./app/middleware/error.middleware.js"
import { prisma } from "./app/prisma.js"

import authRoutes from "./app/auth/auth.routes.js"
import userRoutes from "./app/user/user.routes.js"

import cors from "cors"

dotenv.config()

const app = express()

app.use(cors())

async function main() {
  if (process.env.NODE_ENV === "development") app.use(morgan("dev"))

  app.use(express.json())

  const __dirname = path.resolve()

  app.use("/uploads", express.static(path.join(__dirname, "/uploads/")))

  app.use("/api/auth", authRoutes)
  app.use("/api/users", userRoutes)

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
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
