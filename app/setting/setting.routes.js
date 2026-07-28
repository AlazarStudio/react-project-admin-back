import express from "express"

import { admin, optionalProtect, protect } from "../middleware/auth.middleware.js"

import {
  createProcessStep,
  createStat,
  deleteProcessStep,
  deleteStat,
  getProcessSteps,
  getSettings,
  getStats,
  updateProcessStep,
  updateSettings,
  updateStat,
} from "./setting.controller.js"

const router = express.Router()

// Вложенные коллекции объявляем до "/", чтобы они не перехватывались.
router
  .route("/stats")
  .get(getStats) // публично
  .post(protect, admin, createStat)

router
  .route("/stats/:id")
  .put(protect, admin, updateStat)
  .delete(protect, admin, deleteStat)

router
  .route("/process")
  .get(getProcessSteps) // публично
  .post(protect, admin, createProcessStep)

router
  .route("/process/:id")
  .put(protect, admin, updateProcessStep)
  .delete(protect, admin, deleteProcessStep)

router
  .route("/")
  // Публично: контакты, счётчики, robots + статистика и этапы одним запросом.
  // optionalProtect — чтобы админ с токеном получил ещё и поля доставки заявок
  // (их же отдаём сайту по заголовку x-api-key, см. getSettings).
  .get(optionalProtect, getSettings)
  .put(protect, admin, updateSettings)

export default router
