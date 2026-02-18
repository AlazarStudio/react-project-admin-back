import fs from "fs"
import path from "path"
import asyncHandler from "express-async-handler"
import multer from "multer"

const uploadsDir = path.resolve("uploads")

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true })
      }
      cb(null, uploadsDir)
    } catch (error) {
      cb(error)
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase()
    const base = path
      .basename(file.originalname || "file", ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 64)
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `${base || "file"}-${unique}${ext}`)
  },
})

export const upload = multer({ storage })

// @desc    Upload media file
// @route   POST /api/admin/media/upload
// @access  Private (Admin)
export const uploadMedia = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400)
    throw new Error("No file uploaded")
  }

  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    filename: req.file.filename,
    mimetype: req.file.mimetype,
    size: req.file.size,
  })
})
