import express from "express"

import { admin, optionalProtect, protect } from "../middleware/auth.middleware.js"

import {
  createSolution,
  deleteSolution,
  getSolution,
  getSolutions,
  updateSolution,
} from "./solution.controller.js"

const router = express.Router()

router
  .route("/")
  // Публично: направления читает сайт. С админским токеном — и черновики.
  .get(optionalProtect, getSolutions)
  .post(protect, admin, createSolution)

router
  .route("/:idOrKey")
  .get(optionalProtect, getSolution)
  .put(protect, admin, updateSolution)
  .delete(protect, admin, deleteSolution)

export default router
