import express from "express"

import { protect } from "../middleware/auth.middleware.js"
import { validateRequest } from "../middleware/validation.middleware.js"

import {
  createNew_Empty,
  delete_Empty,
  get_Empty,
  get_Emptys,
  update_Empty
} from "./_empty.controller.js"

const router = express.Router()

// TODO: Настройте валидацию для ваших полей
// Пример валидации:
// const validateCreate = validateRequest([
//   { field: "name", required: true, minLength: 3, maxLength: 100 },
//   { field: "email", required: true, isEmail: true }
// ])

router
  .route("/")
  .post(
    protect,
    // validateCreate, // Раскомментируйте после настройки валидации
    createNew_Empty
  )
  .get(protect, get_Emptys)

router
  .route("/:id")
  .get(protect, get_Empty)
  .put(
    protect,
    // validateRequest([...]), // Добавьте валидацию для обновления
    update_Empty
  )
  .delete(protect, delete_Empty)

export default router
