import express from "express"
import { protect } from "../middleware/auth.middleware.js"
import {
  getMenuStructure,
  updateMenuStructure
} from "./menuStructure.controller.js"

const router = express.Router()

router
  .route("/")
  .get(protect, getMenuStructure)
  .put(protect, updateMenuStructure)

export default router
