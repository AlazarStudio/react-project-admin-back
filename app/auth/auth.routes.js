import express from "express"

import { validateRequest } from "../middleware/validation.middleware.js"

import { authUser, registerUser } from "./auth.controller.js"

const router = express.Router()

router.route("/login").post(
  validateRequest([
    { field: "login", required: true },
    { field: "password", required: true }
  ]),
  authUser
)

router.route("/register").post(
  validateRequest([
    { field: "login", required: true, minLength: 3, maxLength: 30 },
    { field: "email", required: true, isEmail: true },
    { field: "password", required: true, minLength: 6 }
  ]),
  registerUser
)

export default router
