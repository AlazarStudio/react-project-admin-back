import express from "express"
import { protect, admin } from "../middleware/auth.middleware.js"
import { 
  generateResource,
  getDynamicPage,
  updateDynamicPage,
  createDynamicPage
} from "./generate.controller.js"

const router = express.Router()

router
  .route("/generate/resource")
  .post(protect, admin, generateResource)

// Роуты для динамических страниц (часть генератора)
router
  .route("/dynamic-pages/:slug")
  .get(protect, admin, getDynamicPage)
  .post(protect, admin, createDynamicPage)
  .put(protect, admin, updateDynamicPage)

export default router
