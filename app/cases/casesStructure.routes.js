import express from "express"
import { protect } from "../middleware/auth.middleware.js"
import {
  getCasesStructure,
  updateCasesStructure
} from "./casesStructure.controller.js"

const router = express.Router()

router
  .route("/")
  .get(protect, getCasesStructure)
  .put(protect, updateCasesStructure)

export default router
