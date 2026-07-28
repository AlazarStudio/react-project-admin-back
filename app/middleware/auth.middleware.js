import asyncHandler from "express-async-handler"
import jwt from "jsonwebtoken"

import { prisma } from "../prisma.js"
import { UserFields } from "../utils/user.utils.js"

// Role-based access control middleware
export const admin = asyncHandler(async (req, res, next) => {
  if (req.user && req.user.role === "SUPERADMIN") {
    next()
  } else {
    res.status(403)
    throw new Error("Not authorized as an admin")
  }
})

export const isAdmin = (req) => req.user?.role === "SUPERADMIN"

export const protect = asyncHandler(async (req, res, next) => {
  let token

  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1]
  }

  if (!token) {
    res.status(401)
    throw new Error("Not authorized, no token provided")
  }

  // Разбор токена и поиск пользователя разделены сознательно: ЛЮБАЯ ошибка
  // разбора — это отказ авторизации, а не сбой сервера. Структурно битый JWT
  // (`a.b.c` с непарсибельным payload) роняет jwt.verify ошибкой JSON-парсера,
  // а не JsonWebTokenError, и раньше улетал наружу как 500.
  let decoded
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    res.status(401)
    throw new Error("Not authorized, invalid token")
  }

  if (!decoded?.userId) {
    res.status(401)
    throw new Error("Not authorized, invalid token")
  }

  const userFound = await prisma.user.findUnique({
    where: {
      id: decoded.userId
    },
    select: UserFields
  })

  if (!userFound) {
    res.status(401)
    throw new Error("Not authorized, user not found")
  }

  req.user = userFound
  next()
})

/**
 * Мягкая авторизация для публичных GET: токена может не быть (аноним),
 * но если он передан — он обязан быть валидным, и тогда в req.user окажется
 * пользователь. Нужна там, где анониму видно только опубликованное,
 * а админу — ещё и черновики.
 */
export const optionalProtect = asyncHandler(async (req, res, next) => {
  if (!req.headers.authorization?.startsWith("Bearer")) {
    return next()
  }
  return protect(req, res, next)
})
