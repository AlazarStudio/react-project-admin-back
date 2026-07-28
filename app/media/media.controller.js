import fs from "fs"
import crypto from "crypto"
import path from "path"
import asyncHandler from "express-async-handler"
import multer from "multer"
import sharp from "sharp"

import { prisma } from "../prisma.js"
import {
  badRequest,
  buildPagination,
  getSearchParam,
  has,
  httpError,
  normalizeAlt,
  parsePagination,
  slugify,
  toTrimmedString,
} from "../utils/http.utils.js"

export const uploadsDir = path.resolve("uploads")

// libvips кэширует открытые файлы, и на Windows это держит дескриптор:
// последующий unlink падает с EBUSY, а файл остаётся мусором на диске.
// Для админской загрузки кэш не нужен — отключаем.
sharp.cache(false)

/**
 * Только растровые изображения. SVG сознательно НЕ разрешён: это XML,
 * он умеет исполнять скрипты и отдаётся статикой с того же origin, что и API.
 * Расширение берём отсюда, а не из имени файла клиента.
 */
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/pjpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
  ["image/tiff", ".tiff"],
  ["image/bmp", ".bmp"],
])

const ALLOWED_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".tif", ".tiff", ".bmp",
])

/** Форматы, которые sharp обязан распознать в реально загруженном файле. */
const ALLOWED_SHARP_FORMATS = new Set([
  "jpeg", "png", "webp", "gif", "avif", "heif", "tiff", "magick",
])

/** Расширения, которые безопасно отдавать инлайном из /uploads. */
export const INLINE_SAFE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".tif", ".tiff", ".bmp",
])

function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

// 15 МБ по умолчанию — с запасом для фотографий с телефона и рендеров каталога.
const MAX_UPLOAD_BYTES = envInt("MAX_UPLOAD_BYTES", 15 * 1024 * 1024)

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
    // Имя и расширение генерируем сами. Из originalname берём только
    // «косметическую» часть, вычищенную до [a-z0-9_-]: иначе через
    // originalname можно получить .html/.php/.svg на диске.
    const rawExt = path.extname(file.originalname || "").toLowerCase()
    const base = path
      .basename(file.originalname || "file", rawExt)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48)

    const ext = ALLOWED_IMAGE_TYPES.get(file.mimetype) || ".bin"
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`
    cb(null, `${base || "file"}-${unique}${ext}`)
  },
})

function fileFilter(req, file, cb) {
  const mimetype = String(file.mimetype || "").toLowerCase()
  const ext = path.extname(file.originalname || "").toLowerCase()

  if (!ALLOWED_IMAGE_TYPES.has(mimetype)) {
    return cb(httpError(415, `Unsupported file type: ${mimetype || "unknown"}. Allowed: ${[...ALLOWED_IMAGE_TYPES.keys()].join(", ")}`))
  }
  if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
    return cb(httpError(415, `Unsupported file extension: ${ext}`))
  }

  return cb(null, true)
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    parts: 12,
    fields: 10,
    fieldSize: 8 * 1024,
  },
})

/**
 * Удаляет файл, переживая кратковременную блокировку на Windows (EBUSY/EPERM,
 * например если антивирус или libvips ещё держат дескриптор).
 */
async function removeFileWithRetry(target, attempts = 5) {
  if (!target.startsWith(uploadsDir)) return false

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (!fs.existsSync(target)) return true
      fs.unlinkSync(target)
      return true
    } catch (error) {
      const retriable = error?.code === "EBUSY" || error?.code === "EPERM"
      if (!retriable || attempt === attempts) {
        console.warn("Could not remove file from disk:", error?.message || error)
        return false
      }
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
    }
  }

  return false
}

// @desc    Upload media file (только растровые изображения, всё → WebP)
// @route   POST /api/media/upload  (алиас: /api/admin/media/upload)
// @access  Private (Admin)
export const uploadMedia = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw badRequest("No file uploaded")
  }

  const inputPath = req.file.path

  // Заявленный MIME — это всего лишь заголовок от клиента. Настоящая проверка:
  // содержимое обязано читаться sharp как растровое изображение.
  let metadata
  try {
    metadata = await sharp(inputPath).metadata()
  } catch {
    await removeFileWithRetry(inputPath)
    throw httpError(415, "File is not a valid raster image")
  }

  if (!metadata?.format || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
    await removeFileWithRetry(inputPath)
    throw httpError(415, `Unsupported image format: ${metadata?.format || "unknown"}`)
  }
  if (!metadata.width || !metadata.height) {
    await removeFileWithRetry(inputPath)
    throw httpError(415, "File is not a valid raster image")
  }

  // Перекодирование в WebP — заодно и санитайзер: полиглот (файл, который
  // одновременно валидная картинка и валидный HTML/скрипт) теряет «вторую»
  // половину, потому что на выходе получается заново собранный WebP.
  const parsed = path.parse(req.file.filename)
  const webpFilename = `${parsed.name}.webp`
  const webpPath = path.join(uploadsDir, webpFilename)
  const isAnimated = metadata.pages > 1

  // Если загрузили уже .webp, входной и выходной путь совпадают, а sharp
  // отказывается писать в файл, который сам же читает. Пишем во временный
  // файл и подменяем им исходный.
  const inPlace = path.resolve(webpPath) === path.resolve(inputPath)
  const outputPath = inPlace ? `${webpPath}.tmp` : webpPath

  try {
    const pipeline = isAnimated
      ? sharp(inputPath, { animated: true })
      : sharp(inputPath).rotate()
    await pipeline.webp({ quality: 82 }).toFile(outputPath)
  } catch (error) {
    await removeFileWithRetry(outputPath)
    await removeFileWithRetry(inputPath)
    throw httpError(415, `Could not process image: ${error?.message || "conversion failed"}`)
  }

  await removeFileWithRetry(inputPath)

  if (inPlace) {
    try {
      fs.renameSync(outputPath, webpPath)
    } catch (error) {
      await removeFileWithRetry(outputPath)
      throw httpError(500, `Could not store image: ${error?.message || "rename failed"}`)
    }
  }

  const stats = fs.statSync(webpPath)
  const finalMeta = await sharp(webpPath).metadata().catch(() => null)

  const media = await prisma.media.create({
    data: {
      filename: webpFilename,
      url: `/uploads/${webpFilename}`,
      mimeType: "image/webp",
      size: BigInt(stats.size),
      width: finalMeta?.width ?? metadata.width ?? null,
      height: finalMeta?.height ?? metadata.height ?? null,
      // alt принимается вместе с файлом, если он передан; длина ограничена.
      alt: normalizeAlt(req.body?.alt) || null,
    },
  })

  // Ключи url/filename/mimetype/size сохранены для обратной совместимости
  // со старым ответом шаблона; id/width/height/alt — новые.
  res.status(201).json({
    id: media.id,
    url: media.url,
    filename: media.filename,
    mimetype: media.mimeType,
    mimeType: media.mimeType,
    size: media.size,
    width: media.width,
    height: media.height,
    alt: media.alt,
    createdAt: media.createdAt,
  })
})

// @desc    Get uploaded media
// @route   GET /api/media?page=1&limit=50&search=
// @access  Private (Admin)
export const getMediaList = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 })

  const where = {}
  const search = getSearchParam(req.query)
  if (search) {
    where.OR = [
      { filename: { contains: search, mode: "insensitive" } },
      { alt: { contains: search, mode: "insensitive" } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.media.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
    prisma.media.count({ where }),
  ])

  res.json({ items, pagination: buildPagination({ page, limit, total }) })
})

// @desc    Get media by id
// @route   GET /api/media/:id
// @access  Private (Admin)
export const getMedia = asyncHandler(async (req, res) => {
  const media = await prisma.media.findUnique({ where: { id: req.params.id } })

  if (!media) {
    res.status(404)
    throw new Error("Media not found")
  }

  res.json(media)
})

/** Предел длины имени файла без расширения. */
const MAX_FILENAME_LENGTH = 80

/**
 * Имя файла из того, что ввёл редактор.
 *
 * Расширение берём у существующего файла, а введённое отбрасываем: тип файла
 * задан его содержимым (всё лежит в WebP), и позволить сменить расширение
 * через имя — это ровно та дыра, которую закрывает генерация имени при
 * загрузке. Кириллица транслитерируется: имя попадает в адрес картинки, а
 * кириллический адрес уезжает в проценты и читается хуже.
 */
function buildFilename(existing, raw) {
  const value = toTrimmedString(raw)
  if (!value) throw badRequest("Имя файла не может быть пустым")

  const ext = path.extname(existing.filename).toLowerCase() || ".webp"
  const base = slugify(path.basename(value, path.extname(value)), "")
    .slice(0, MAX_FILENAME_LENGTH)
    .replace(/-+$/, "")

  if (!base) {
    throw badRequest("В имени нет ни одной буквы или цифры — переименовать нечем")
  }

  return `${base}${ext}`
}

/**
 * Замена адреса картинки внутри произвольного значения из jsonb.
 *
 * Сравнение строгое, по всей строке: `includes`/`replace` зацепили бы соседний
 * файл, чьё имя начинается так же (`/uploads/dom.webp` и `/uploads/dom-2.webp`).
 */
function replaceUrlDeep(value, oldUrl, newUrl) {
  if (typeof value === "string") return value === oldUrl ? newUrl : value
  if (Array.isArray(value)) return value.map((item) => replaceUrlDeep(item, oldUrl, newUrl))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceUrlDeep(item, oldUrl, newUrl)]),
    )
  }
  return value
}

/**
 * Переписывает ссылки на переименованный файл во всём контенте.
 *
 * Без этого переименование ломало бы уже расставленные картинки: адреса лежат
 * в товарах, статьях и направлениях простыми строками, внешнего ключа на
 * медиатеку у них нет.
 *
 * Строки читаются целиком, а не выбираются запросом по подстроке: контента
 * здесь десятки записей, а адрес прячется внутри jsonb на разной глубине —
 * искать его SQL-ом дороже и ненадёжнее, чем сравнить в памяти.
 */
async function rewriteMediaReferences(tx, oldUrl, newUrl) {
  let updated = 0

  const products = await tx.product.findMany({ select: { id: true, image: true, images: true } })
  for (const product of products) {
    const image = product.image === oldUrl ? newUrl : product.image
    const images = replaceUrlDeep(product.images, oldUrl, newUrl)
    if (image !== product.image || JSON.stringify(images) !== JSON.stringify(product.images)) {
      await tx.product.update({ where: { id: product.id }, data: { image, images } })
      updated += 1
    }
  }

  const articles = await tx.article.findMany({ select: { id: true, image: true, sections: true } })
  for (const article of articles) {
    const image = article.image === oldUrl ? newUrl : article.image
    const sections = replaceUrlDeep(article.sections, oldUrl, newUrl)
    if (image !== article.image || JSON.stringify(sections) !== JSON.stringify(article.sections)) {
      await tx.article.update({ where: { id: article.id }, data: { image, sections } })
      updated += 1
    }
  }

  const solutionProducts = await tx.solutionProduct.findMany({
    where: { image: oldUrl },
    select: { id: true },
  })
  for (const item of solutionProducts) {
    await tx.solutionProduct.update({ where: { id: item.id }, data: { image: newUrl } })
    updated += 1
  }

  return updated
}

// @desc    Update media meta (alt, имя файла)
// @route   PUT /api/media/:id
// @access  Private (Admin)
export const updateMedia = asyncHandler(async (req, res) => {
  const existing = await prisma.media.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("Media not found")
  }

  const data = {}
  // Обновляем только переданные поля: остальное (размеры, mime) не трогаем.
  if (has(req.body, "alt")) data.alt = normalizeAlt(req.body.alt) || null

  let rename = null
  if (has(req.body, "filename")) {
    const filename = buildFilename(existing, req.body.filename)

    // Совпало с текущим — переименования нет: и файл не трогаем, и ссылки.
    if (filename !== existing.filename) {
      const url = `/uploads/${filename}`
      const taken = await prisma.media.findFirst({ where: { url, NOT: { id: existing.id } } })
      if (taken) {
        throw httpError(409, `Файл с именем «${filename}» уже есть в медиатеке`)
      }

      const from = path.join(uploadsDir, path.basename(existing.filename))
      const to = path.join(uploadsDir, filename)
      // Файл без записи в базе — это чужой мусор в uploads. Переименование
      // затёрло бы его молча, поэтому отказываемся.
      if (fs.existsSync(to)) {
        throw httpError(409, `На диске уже есть файл «${filename}»`)
      }

      rename = { from, to, filename, url }
      data.filename = filename
      data.url = url
    }
  }

  if (!rename) {
    const media = await prisma.media.update({ where: { id: existing.id }, data })
    return res.json(media)
  }

  try {
    fs.renameSync(rename.from, rename.to)
  } catch (error) {
    throw httpError(500, `Не удалось переименовать файл: ${error?.message || "ошибка диска"}`)
  }

  try {
    const media = await prisma.$transaction(async (tx) => {
      const updated = await tx.media.update({ where: { id: existing.id }, data })
      await rewriteMediaReferences(tx, existing.url, rename.url)
      return updated
    })
    res.json(media)
  } catch (error) {
    // База не приняла изменения — возвращаем файл на место, иначе записи
    // указывали бы на исчезнувший адрес.
    try {
      fs.renameSync(rename.to, rename.from)
    } catch (revertError) {
      console.error("Не удалось вернуть файл после сбоя переименования:", revertError?.message || revertError)
    }
    throw error
  }
})

// @desc    Delete media (запись + файл на диске)
// @route   DELETE /api/media/:id
// @access  Private (Admin)
export const deleteMedia = asyncHandler(async (req, res) => {
  const existing = await prisma.media.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("Media not found")
  }

  await prisma.media.delete({ where: { id: existing.id } })

  // Файл удаляем после записи: путь собираем из basename, чтобы исключить
  // выход за пределы uploads.
  const target = path.join(uploadsDir, path.basename(existing.filename))
  const removed = await removeFileWithRetry(target)

  res.json({ message: "Media deleted successfully", id: existing.id, fileRemoved: removed })
})
