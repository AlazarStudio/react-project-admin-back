import { faker } from "@faker-js/faker"
import { hash, verify } from "argon2"
import crypto from "crypto"
import asyncHandler from "express-async-handler"

import { prisma } from "../prisma.js"
import { badRequest, httpError } from "../utils/http.utils.js"
import { UserFields } from "../utils/user.utils.js"

import { generateToken } from "./generate-token.js"

/**
 * Хеш-заглушка от случайного пароля. Если пользователя нет, всё равно
 * выполняем полноценную проверку argon2: иначе несуществующий логин отвечает
 * заметно быстрее существующего и логины можно перебирать по времени ответа.
 */
let dummyHashPromise = null
function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = hash(crypto.randomBytes(32).toString("hex"))
  }
  return dummyHashPromise
}

// Одно и то же сообщение на «нет такого логина» и «неверный пароль».
const INVALID_CREDENTIALS = "Invalid login or password"

// @desc    Auth user
// @route   POST /api/auth/login
// @access  Public (с ограничением частоты)
export const authUser = asyncHandler(async (req, res) => {
  const { login, password } = req.body || {}

  if (typeof login !== "string" || typeof password !== "string" || !login || !password) {
    throw badRequest("Please provide login and password")
  }

  const user = await prisma.user.findUnique({ where: { login } })

  if (!user) {
    // Выравниваем время ответа, результат намеренно игнорируем.
    await verify(await getDummyHash(), password).catch(() => false)
    throw httpError(401, INVALID_CREDENTIALS)
  }

  const isValidPassword = await verify(user.password, password).catch(() => false)

  if (!isValidPassword) {
    throw httpError(401, INVALID_CREDENTIALS)
  }

  const token = generateToken(user.id)
  res.json({
    user: {
      id: user.id,
      email: user.email,
      login: user.login,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    },
    token
  })
})

// @desc    Register user (заводит администратор — публичной регистрации нет)
// @route   POST /api/auth/register
// @access  Private (Admin)
export const registerUser = asyncHandler(async (req, res) => {
  const { login, email, password, name, role } = req.body || {}

  if (typeof login !== "string" || typeof email !== "string" || typeof password !== "string") {
    throw badRequest("Please provide login, email and password")
  }

  if (password.length < 8) {
    throw badRequest("Password must be at least 8 characters")
  }

  if (role !== undefined && role !== "USER" && role !== "SUPERADMIN") {
    throw badRequest('role must be "USER" or "SUPERADMIN"')
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ login }, { email }] },
  })

  // Не уточняем, что именно занято — логин или почта.
  if (existing) {
    throw httpError(409, "User with these credentials already exists")
  }

  const user = await prisma.user.create({
    data: {
      login,
      email,
      password: await hash(password),
      name: name || faker.person.fullName(),
      role: role || "USER",
    },
    select: UserFields
  })

  res.status(201).json({ user })
})
