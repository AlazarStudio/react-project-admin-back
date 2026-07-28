import express from "express"
import { protect, admin } from "../middleware/auth.middleware.js"
import {
  deleteMedia,
  getMedia,
  getMediaList,
  updateMedia,
  upload,
  uploadMedia,
} from "./media.controller.js"

const router = express.Router()

// Все три маршрута принимают ТОЛЬКО растровые изображения (см. media.controller.js).
// upload-document / upload-video оставлены как алиасы ради совместимости
// со старой админкой; загрузка документов и видео сейчас не поддерживается.
router.post("/upload", protect, admin, upload.single("file"), uploadMedia)
router.post("/upload-document", protect, admin, upload.single("file"), uploadMedia)
router.post("/upload-video", protect, admin, upload.single("file"), uploadMedia)

router.route("/").get(protect, admin, getMediaList)

router
  .route("/:id")
  .get(protect, admin, getMedia)
  .put(protect, admin, updateMedia)
  .delete(protect, admin, deleteMedia)

export default router
