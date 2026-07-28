import express from "express"

import { admin, optionalProtect, protect } from "../middleware/auth.middleware.js"

import {
  createProduct,
  deleteProduct,
  getProduct,
  getProducts,
  updateProduct,
} from "./product.controller.js"

const router = express.Router()

router
  .route("/")
  // Публично: каталог читает сайт. optionalProtect нужен, чтобы админ
  // с токеном мог запросить ещё и черновики (?published=all).
  .get(optionalProtect, getProducts)
  .post(protect, admin, createProduct)

router
  .route("/:idOrSlug")
  .get(optionalProtect, getProduct)
  .put(protect, admin, updateProduct)
  .delete(protect, admin, deleteProduct)

export default router
