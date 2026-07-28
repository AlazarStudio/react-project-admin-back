import express from "express"

import { admin, protect } from "../middleware/auth.middleware.js"

import { getConfig, updateConfig } from "./config.controller.js"

const router = express.Router()

router
  .route("/")
  // GET публичный: фронт читает адрес API до авторизации.
  .get(getConfig)
  // PUT переписывает адрес API для всего фронта — только администратор.
  .put(protect, admin, updateConfig)

export default router
