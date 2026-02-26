import fs from "fs"
import path from "path"
import asyncHandler from "express-async-handler"
import multer from "multer"
import sharp from "sharp"

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

  const isImage = typeof req.file.mimetype === "string" && req.file.mimetype.startsWith("image/")
  let filename = req.file.filename
  let url = `/uploads/${filename}`
  let mimetype = req.file.mimetype
  let size = req.file.size

  if (isImage) {
    const inputPath = req.file.path
    const parsed = path.parse(req.file.filename)
    const webpFilename = `${parsed.name}.webp`
    const webpPath = path.join(uploadsDir, webpFilename)

    try {
      await sharp(inputPath).rotate().webp({ quality: 82 }).toFile(webpPath)
      fs.unlinkSync(inputPath)
    } catch (error) {
      if (fs.existsSync(webpPath)) fs.unlinkSync(webpPath)
      throw error
    }

    const stats = fs.statSync(webpPath)
    filename = webpFilename
    url = `/uploads/${filename}`
    mimetype = "image/webp"
    size = stats.size
  }

  res.status(201).json({
    url,
    filename,
    mimetype,
    size,
  })
})
