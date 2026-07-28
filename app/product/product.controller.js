import asyncHandler from "express-async-handler"

import { isAdmin } from "../middleware/auth.middleware.js"
import { prisma } from "../prisma.js"
import {
  badRequest,
  buildPagination,
  getSearchParam,
  getStringParam,
  has,
  httpError,
  isLocalAssetPath,
  missingFields,
  nextSortOrder,
  normalizeAlt,
  parsePagination,
  parseSortOrder,
  slugify,
  toBoolean,
  toStringArray,
  toTrimmedString,
} from "../utils/http.utils.js"

const REQUIRED_FIELDS = ["name", "image", "purpose", "type", "exploitation", "size", "description"]

const STRING_FIELDS = ["name", "image", "purpose", "type", "exploitation", "size", "description"]
const ARRAY_FIELDS = ["tags", "options", "complectation"]

/** Верхний предел галереи одного товара. */
const MAX_IMAGES = 24

/**
 * Галерея товара: массив { src, alt } в порядке показа.
 *
 * Порядок значим. Дубликаты по src схлопываются — побеждает ПЕРВОЕ вхождение
 * целиком, вместе со своим alt: так результат зависит только от порядка,
 * а не от того, где редактор случайно оставил более длинное описание.
 *
 * Ради независимой выкатки фронта принимается и старый формат — элемент-строка
 * трактуется как { src, alt: "" }.
 */
function normalizeImages(value) {
  if (value === undefined || value === null) return []

  if (!Array.isArray(value)) {
    throw badRequest('"images" must be an array of { src, alt } objects')
  }

  const seen = new Set()
  const images = []

  value.forEach((raw, index) => {
    const at = `images[${index}]`

    let src
    let alt

    if (typeof raw === "string") {
      src = raw.trim()
      alt = ""
    } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      src = toTrimmedString(raw.src)
      alt = normalizeAlt(raw.alt, `"${at}.alt"`)
    } else {
      throw badRequest(`"${at}" must be an object with "src" and "alt"`)
    }

    if (!src) {
      throw badRequest(`"${at}.src" is required and must be a non-empty string`)
    }
    if (!isLocalAssetPath(src)) {
      throw badRequest(
        `"${at}.src" must be a local path starting with a single "/" — ` +
          `got "${src}". External URLs are not allowed.`
      )
    }

    if (seen.has(src)) return
    seen.add(src)
    images.push({ src, alt })
  })

  // Предел считаем после схлопывания дублей: хранить будем именно столько.
  if (images.length > MAX_IMAGES) {
    throw badRequest(`"images" must contain no more than ${MAX_IMAGES} photos, got ${images.length}`)
  }

  return images
}

/** Обложка обязана быть локальным путём — она же первый кандидат в галерею. */
function assertCoverIsLocal(image) {
  if (!isLocalAssetPath(image)) {
    throw badRequest(
      `"image" must be a local path starting with a single "/" — got "${image}". ` +
        "External URLs are not allowed."
    )
  }
}

/** Обложка обязана присутствовать в галерее — иначе данные рассогласованы. */
function assertCoverInGallery(image, images) {
  if (!images.some((photo) => photo.src === image)) {
    throw badRequest(
      `"image" (the cover) must be one of the uploaded photos in "images". ` +
        `Cover "${image}" is not present in the gallery.`
    )
  }
}

/**
 * Фильтр публикации.
 * Анониму доступны ТОЛЬКО опубликованные товары; черновики (`all` / `false`)
 * требуют админского токена, иначе 403.
 */
function publishedFilter(query, admin) {
  const requested = getStringParam(query, "published")

  if (!requested) return { published: true }

  if (!["all", "true", "false"].includes(requested)) {
    throw badRequest('Query parameter "published" must be one of: all, true, false')
  }

  if (requested !== "true" && !admin) {
    throw httpError(403, "Not authorized to read unpublished content")
  }

  if (requested === "all") return {}
  return { published: requested === "true" }
}

function buildWhere(query, admin) {
  const where = { ...publishedFilter(query, admin) }

  const search = getSearchParam(query)
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { purpose: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ]
  }

  const type = getStringParam(query, "type")
  if (type) where.type = type

  const exploitation = getStringParam(query, "exploitation")
  if (exploitation) where.exploitation = exploitation

  const tag = getStringParam(query, "tag")
  if (tag) where.tags = { has: tag }

  const option = getStringParam(query, "option")
  if (option) where.options = { has: option }

  const individual = getStringParam(query, "individual")
  if (individual) {
    if (!["true", "false"].includes(individual)) {
      throw badRequest('Query parameter "individual" must be "true" or "false"')
    }
    where.individual = individual === "true"
  }

  return where
}

/** Собирает данные для create/update. На update берём только присланные ключи. */
function buildData(body, { partial }) {
  const data = {}

  for (const field of STRING_FIELDS) {
    if (!partial || has(body, field)) data[field] = toTrimmedString(body[field])
  }

  for (const field of ARRAY_FIELDS) {
    if (!partial || has(body, field)) data[field] = toStringArray(body[field])
  }

  if (!partial || has(body, "individual")) data.individual = toBoolean(body.individual, false)
  if (!partial || has(body, "published")) data.published = toBoolean(body.published, true)
  if (has(body, "sortOrder")) data.sortOrder = parseSortOrder(body.sortOrder)

  return data
}

/** Уникальный slug: если занят — добавляем числовой суффикс. */
async function ensureUniqueSlug(base, excludeId = null) {
  const root = slugify(base, "product")
  let candidate = root
  let suffix = 2

  for (;;) {
    const existing = await prisma.product.findUnique({ where: { slug: candidate } })
    if (!existing || existing.id === excludeId) return candidate
    candidate = `${root}-${suffix}`
    suffix += 1
  }
}

async function findByIdOrSlug(idOrSlug) {
  return prisma.product.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  })
}

// @desc    Get products
// @route   GET /api/products?page=1&limit=100&search=&type=&published=all
// @access  Public (черновики — только админу)
export const getProducts = asyncHandler(async (req, res) => {
  const admin = isAdmin(req)
  const { page, limit, skip } = parsePagination(req.query)
  const where = buildWhere(req.query, admin)

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.product.count({ where }),
  ])

  res.json({ items, pagination: buildPagination({ page, limit, total }) })
})

// @desc    Get product by id or slug
// @route   GET /api/products/:idOrSlug
// @access  Public (черновики — только админу)
export const getProduct = asyncHandler(async (req, res) => {
  const product = await findByIdOrSlug(req.params.idOrSlug)

  // Неопубликованный товар для анонима не существует: отвечаем 404, а не 403,
  // чтобы не подтверждать наличие черновика.
  if (!product || (!product.published && !isAdmin(req))) {
    res.status(404)
    throw new Error("Product not found")
  }

  res.json(product)
})

// @desc    Create product
// @route   POST /api/products
// @access  Private (Admin)
export const createProduct = asyncHandler(async (req, res) => {
  const missing = missingFields(req.body, REQUIRED_FIELDS)
  if (missing.length > 0) {
    throw badRequest(`Missing or empty required fields: ${missing.join(", ")}`)
  }

  const data = buildData(req.body, { partial: false })
  assertCoverIsLocal(data.image)

  // Галерея не передана — заполняем обложкой, чтобы данные всегда были
  // согласованы и на сайте не оказалось товара с пустой галереей.
  const images = has(req.body, "images") ? normalizeImages(req.body.images) : []
  // Галерея не передана — собираем её из обложки. alt берём из названия
  // товара: пустой alt на проде выглядит хуже, чем осмысленное описание.
  data.images = images.length > 0 ? images : [{ src: data.image, alt: data.name }]
  assertCoverInGallery(data.image, data.images)

  data.slug = await ensureUniqueSlug(toTrimmedString(req.body.slug) || data.name)

  if (!has(req.body, "sortOrder")) {
    data.sortOrder = await nextSortOrder(prisma.product)
  }

  const product = await prisma.product.create({ data })

  res.status(201).json(product)
})

// @desc    Update product
// @route   PUT /api/products/:idOrSlug
// @access  Private (Admin)
export const updateProduct = asyncHandler(async (req, res) => {
  const existing = await findByIdOrSlug(req.params.idOrSlug)

  if (!existing) {
    res.status(404)
    throw new Error("Product not found")
  }

  const data = buildData(req.body, { partial: true })

  for (const field of REQUIRED_FIELDS) {
    if (has(req.body, field) && !data[field]) {
      throw badRequest(`Field "${field}" must be a non-empty string`)
    }
  }

  // Обложка после этого запроса: либо новая из тела, либо прежняя.
  const nextCover = has(req.body, "image") ? data.image : existing.image
  if (has(req.body, "image")) assertCoverIsLocal(nextCover)

  // alt для галереи-заглушки: новое название, если его меняют, иначе прежнее.
  const coverAlt = has(req.body, "name") ? data.name : existing.name

  if (has(req.body, "images")) {
    const images = normalizeImages(req.body.images)
    assertCoverIsLocal(nextCover)
    data.images = images.length > 0 ? images : [{ src: nextCover, alt: coverAlt }]
    assertCoverInGallery(nextCover, data.images)
  } else if (has(req.body, "image")) {
    // Галерею не трогаем, но рассогласовать её сменой обложки не даём.
    const current = Array.isArray(existing.images) ? existing.images : []
    if (current.length === 0) {
      // Подстраховка для записей, созданных до появления галереи.
      data.images = [{ src: nextCover, alt: coverAlt }]
    } else {
      assertCoverInGallery(nextCover, current)
    }
  }

  if (has(req.body, "slug")) {
    data.slug = await ensureUniqueSlug(toTrimmedString(req.body.slug) || existing.name, existing.id)
  }

  const product = await prisma.product.update({ where: { id: existing.id }, data })

  res.json(product)
})

// @desc    Delete product
// @route   DELETE /api/products/:idOrSlug
// @access  Private (Admin)
export const deleteProduct = asyncHandler(async (req, res) => {
  const existing = await findByIdOrSlug(req.params.idOrSlug)

  if (!existing) {
    res.status(404)
    throw new Error("Product not found")
  }

  await prisma.product.delete({ where: { id: existing.id } })

  res.json({ message: "Product deleted successfully", id: existing.id })
})
