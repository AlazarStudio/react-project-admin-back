import express from "express"

import { admin, optionalProtect, protect } from "../middleware/auth.middleware.js"

import {
  createFaqItem,
  deleteFaqItem,
  getFaqItem,
  getFaqItems,
  updateFaqItem,
} from "./faq.controller.js"

const router = express.Router()

router
  .route("/")
  // Публично: вопросы читает сайт. optionalProtect нужен, чтобы админ
  // с токеном мог запросить ещё и снятые с публикации (?published=all).
  .get(optionalProtect, getFaqItems)
  .post(protect, admin, createFaqItem)

router
  .route("/:id")
  .get(optionalProtect, getFaqItem)
  .put(protect, admin, updateFaqItem)
  .delete(protect, admin, deleteFaqItem)

export default router
