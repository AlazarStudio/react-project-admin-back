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
  nextSortOrder,
  parsePagination,
  parseSortOrder,
  requireBoolean,
  toBoolean,
  toTrimmedString,
} from "../utils/http.utils.js"

const MAX_QUESTION = 300
const MAX_ANSWER = 2000

/**
 * Анониму доступны ТОЛЬКО опубликованные вопросы; черновики (`all` / `false`)
 * требуют админского токена, иначе 403. Такой же порядок, как у товаров,
 * статей и направлений.
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

/** Обязательное текстовое поле с ограничением длины. */
function requireText(body, field, max) {
  const raw = body?.[field]

  if (raw !== undefined && typeof raw !== "string") {
    throw badRequest(`"${field}" must be a string`)
  }

  const value = toTrimmedString(raw)
  if (!value) {
    throw badRequest(`"${field}" is required and must be a non-empty string`)
  }
  if (value.length > max) {
    throw badRequest(`"${field}" must be no longer than ${max} characters, got ${value.length}`)
  }

  return value
}

function buildData(body, { partial }) {
  const data = {}

  if (!partial || has(body, "question")) data.question = requireText(body, "question", MAX_QUESTION)
  if (!partial || has(body, "answer")) data.answer = requireText(body, "answer", MAX_ANSWER)
  if (!partial || has(body, "published")) data.published = toBoolean(body.published, true)

  // Строгий boolean: см. requireBoolean. При создании без поля — true,
  // чтобы новый вопрос вёл себя как остальные.
  if (has(body, "showOnHome")) {
    data.showOnHome = requireBoolean(body.showOnHome, "showOnHome")
  } else if (!partial) {
    data.showOnHome = true
  }

  if (has(body, "sortOrder")) data.sortOrder = parseSortOrder(body.sortOrder)

  return data
}

// @desc    Get FAQ items
// @route   GET /api/faq?published=all&search=
// @access  Public (черновики — только админу)
export const getFaqItems = asyncHandler(async (req, res) => {
  const admin = isAdmin(req)
  const { page, limit, skip } = parsePagination(req.query)
  const where = { ...publishedFilter(req.query, admin) }

  const search = getSearchParam(req.query)
  if (search) {
    where.OR = [
      { question: { contains: search, mode: "insensitive" } },
      { answer: { contains: search, mode: "insensitive" } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.faqItem.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.faqItem.count({ where }),
  ])

  res.json({ items, pagination: buildPagination({ page, limit, total }) })
})

// @desc    Get FAQ item by id
// @route   GET /api/faq/:id
// @access  Public (черновики — только админу)
export const getFaqItem = asyncHandler(async (req, res) => {
  const item = await prisma.faqItem.findUnique({ where: { id: req.params.id } })

  // Снятый с публикации вопрос для анонима не существует: 404, а не 403,
  // чтобы не подтверждать наличие черновика.
  if (!item || (!item.published && !isAdmin(req))) {
    res.status(404)
    throw new Error("FAQ item not found")
  }

  res.json(item)
})

// @desc    Create FAQ item
// @route   POST /api/faq
// @access  Private (Admin)
export const createFaqItem = asyncHandler(async (req, res) => {
  const data = buildData(req.body, { partial: false })

  if (!has(req.body, "sortOrder")) {
    data.sortOrder = await nextSortOrder(prisma.faqItem)
  }

  const item = await prisma.faqItem.create({ data })

  res.status(201).json(item)
})

// @desc    Update FAQ item
// @route   PUT /api/faq/:id
// @access  Private (Admin)
export const updateFaqItem = asyncHandler(async (req, res) => {
  const existing = await prisma.faqItem.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("FAQ item not found")
  }

  const data = buildData(req.body, { partial: true })
  const item = await prisma.faqItem.update({ where: { id: existing.id }, data })

  res.json(item)
})

// @desc    Delete FAQ item
// @route   DELETE /api/faq/:id
// @access  Private (Admin)
export const deleteFaqItem = asyncHandler(async (req, res) => {
  const existing = await prisma.faqItem.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("FAQ item not found")
  }

  await prisma.faqItem.delete({ where: { id: existing.id } })

  res.json({ message: "FAQ item deleted successfully", id: existing.id })
})
