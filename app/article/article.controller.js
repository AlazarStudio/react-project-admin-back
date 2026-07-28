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
  missingFields,
  nextSortOrder,
  parsePagination,
  parseSortOrder,
  slugify,
  toBoolean,
  toDate,
  toStringArray,
  toTrimmedString,
} from "../utils/http.utils.js"

import { normalizeSections } from "./article-blocks.js"

const REQUIRED_FIELDS = ["title", "description", "excerpt", "image", "imageAlt", "readingTime"]

const STRING_FIELDS = ["title", "description", "excerpt", "image", "imageAlt", "readingTime"]
const ARRAY_FIELDS = ["keywords", "intro"]

/**
 * Анониму доступны только опубликованные статьи;
 * черновики (`all` / `false`) — исключительно с админским токеном.
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

function buildData(body, { partial }) {
  const data = {}

  for (const field of STRING_FIELDS) {
    if (!partial || has(body, field)) data[field] = toTrimmedString(body[field])
  }

  for (const field of ARRAY_FIELDS) {
    if (!partial || has(body, field)) data[field] = toStringArray(body[field])
  }

  if (!partial || has(body, "sections")) {
    data.sections = normalizeSections(body.sections ?? [])
  }

  if (!partial || has(body, "published")) data.published = toBoolean(body.published, true)
  if (has(body, "sortOrder")) data.sortOrder = parseSortOrder(body.sortOrder)

  if (!partial || has(body, "publishedAt")) {
    const publishedAt = toDate(body.publishedAt)
    if (has(body, "publishedAt") && !publishedAt) {
      throw badRequest("publishedAt must be a valid date")
    }
    data.publishedAt = publishedAt || new Date()
  }

  if (!partial || has(body, "updatedAt")) {
    const updatedAt = toDate(body.updatedAt)
    if (has(body, "updatedAt") && !updatedAt) {
      throw badRequest("updatedAt must be a valid date")
    }
    data.updatedAt = updatedAt || data.publishedAt || new Date()
  } else if (partial) {
    // Контентная дата обновления двигается автоматически при любом сохранении.
    data.updatedAt = new Date()
  }

  return data
}

async function ensureUniqueSlug(base, excludeId = null) {
  const root = slugify(base, "article")
  let candidate = root
  let suffix = 2

  for (;;) {
    const existing = await prisma.article.findUnique({ where: { slug: candidate } })
    if (!existing || existing.id === excludeId) return candidate
    candidate = `${root}-${suffix}`
    suffix += 1
  }
}

async function findByIdOrSlug(idOrSlug) {
  return prisma.article.findFirst({
    where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
  })
}

// @desc    Get articles
// @route   GET /api/articles?page=1&limit=100&search=&published=all
// @access  Public (черновики — только админу)
export const getArticles = asyncHandler(async (req, res) => {
  const admin = isAdmin(req)
  const { page, limit, skip } = parsePagination(req.query)
  const where = { ...publishedFilter(req.query, admin) }

  const search = getSearchParam(req.query)
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
      { excerpt: { contains: search, mode: "insensitive" } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.article.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: "asc" }, { publishedAt: "desc" }],
    }),
    prisma.article.count({ where }),
  ])

  res.json({ items, pagination: buildPagination({ page, limit, total }) })
})

// @desc    Get article by id or slug
// @route   GET /api/articles/:idOrSlug
// @access  Public (черновики — только админу)
export const getArticle = asyncHandler(async (req, res) => {
  const article = await findByIdOrSlug(req.params.idOrSlug)

  // Черновик для анонима не существует: 404, а не 403.
  if (!article || (!article.published && !isAdmin(req))) {
    res.status(404)
    throw new Error("Article not found")
  }

  res.json(article)
})

// @desc    Create article
// @route   POST /api/articles
// @access  Private (Admin)
export const createArticle = asyncHandler(async (req, res) => {
  const missing = missingFields(req.body, REQUIRED_FIELDS)
  if (missing.length > 0) {
    throw badRequest(`Missing or empty required fields: ${missing.join(", ")}`)
  }

  const data = buildData(req.body, { partial: false })

  data.slug = await ensureUniqueSlug(toTrimmedString(req.body.slug) || data.title)

  if (!has(req.body, "sortOrder")) {
    data.sortOrder = await nextSortOrder(prisma.article)
  }

  const article = await prisma.article.create({ data })

  res.status(201).json(article)
})

// @desc    Update article
// @route   PUT /api/articles/:idOrSlug
// @access  Private (Admin)
export const updateArticle = asyncHandler(async (req, res) => {
  const existing = await findByIdOrSlug(req.params.idOrSlug)

  if (!existing) {
    res.status(404)
    throw new Error("Article not found")
  }

  const data = buildData(req.body, { partial: true })

  for (const field of REQUIRED_FIELDS) {
    if (has(req.body, field) && !data[field]) {
      throw badRequest(`Field "${field}" must be a non-empty string`)
    }
  }

  if (has(req.body, "slug")) {
    data.slug = await ensureUniqueSlug(toTrimmedString(req.body.slug) || existing.title, existing.id)
  }

  const article = await prisma.article.update({ where: { id: existing.id }, data })

  res.json(article)
})

// @desc    Delete article
// @route   DELETE /api/articles/:idOrSlug
// @access  Private (Admin)
export const deleteArticle = asyncHandler(async (req, res) => {
  const existing = await findByIdOrSlug(req.params.idOrSlug)

  if (!existing) {
    res.status(404)
    throw new Error("Article not found")
  }

  await prisma.article.delete({ where: { id: existing.id } })

  res.json({ message: "Article deleted successfully", id: existing.id })
})
