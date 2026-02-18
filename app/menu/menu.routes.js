import express from "express"
import { protect } from "../middleware/auth.middleware.js"
import {
  getMenus,
  getMenuById,
  createMenu,
  updateMenu,
  deleteMenu
} from "./menu.controller.js"

const router = express.Router()

router
  .route("/")
  .get(getMenus)
  .put(protect, updateMenu)
  .post(protect, createMenu)

router
  .route("/:id")
  .get(protect, getMenuById)
  .delete(protect, deleteMenu)

export default router
