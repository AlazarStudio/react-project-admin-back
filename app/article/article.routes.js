import express from "express"

import { admin, optionalProtect, protect } from "../middleware/auth.middleware.js"

import {
  createArticle,
  deleteArticle,
  getArticle,
  getArticles,
  updateArticle,
} from "./article.controller.js"

const router = express.Router()

router
  .route("/")
  // Публично: блог читает сайт. С админским токеном доступны черновики.
  .get(optionalProtect, getArticles)
  .post(protect, admin, createArticle)

router
  .route("/:idOrSlug")
  .get(optionalProtect, getArticle)
  .put(protect, admin, updateArticle)
  .delete(protect, admin, deleteArticle)

export default router
