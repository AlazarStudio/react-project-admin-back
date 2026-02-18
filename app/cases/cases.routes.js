import express from "express"
import { protect } from "../middleware/auth.middleware.js"
import {
  getCasess,
  getCasesById,
  createCases,
  updateCases,
  deleteCases
} from "./cases.controller.js"

const router = express.Router()

router
  .route("/")
  .get(protect, getCasess)
  .post(protect, createCases)

router
  .route("/:id")
  .get(protect, getCasesById)
  .put(protect, updateCases)
  .delete(protect, deleteCases)

export default router
