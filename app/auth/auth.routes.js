import express from "express"

import { admin, protect } from "../middleware/auth.middleware.js"
import { loginRateLimit } from "../middleware/rate-limit.middleware.js"
import { validateRequest } from "../middleware/validation.middleware.js"

import { authUser, registerUser } from "./auth.controller.js"

const router = express.Router()

router.route("/login").post(
  loginRateLimit,
  validateRequest([
    { field: "login", required: true },
    { field: "password", required: true }
  ]),
  authUser
)

// Регистрация закрыта: это API админки, а не публичный сервис.
// Первый администратор создаётся сидом (npm run seed), остальных заводит он же.
router.route("/register").post(
  protect,
  admin,
  validateRequest([
    { field: "login", required: true, minLength: 3, maxLength: 30 },
    { field: "email", required: true, isEmail: true },
    { field: "password", required: true, minLength: 8 }
  ]),
  registerUser
)

export default router
