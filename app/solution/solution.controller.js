import asyncHandler from "express-async-handler"

import { isAdmin } from "../middleware/auth.middleware.js"
import { prisma } from "../prisma.js"
import {
  badRequest,
  buildPagination,
  getStringParam,
  has,
  httpError,
  missingFields,
  nextSortOrder,
  parsePagination,
  parseSortOrder,
  slugify,
  toBoolean,
  toStringArray,
  toTrimmedString,
} from "../utils/http.utils.js"

const REQUIRED_FIELDS = ["icon", "label", "kicker", "title", "description"]
const STRING_FIELDS = ["icon", "label", "kicker", "title", "description"]

/** Вложенные товары-примеры направления отдаём вместе с направлением. */
const WITH_PRODUCTS = {
  products: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
}

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

function normalizeProducts(value) {
  if (!Array.isArray(value)) {
    throw badRequest("products must be an array")
  }

  const seen = new Set()

  return value.map((item, index) => {
    const name = toTrimmedString(item?.name)
    const image = toTrimmedString(item?.image)

    if (!name || !image) {
      throw badRequest(`products[${index}] requires both "name" and "image"`)
    }
    // (solutionId, name) — составной уникальный ключ в схеме.
    if (seen.has(name)) {
      throw badRequest(`products[${index}] duplicates name "${name}" within the same solution`)
    }
    seen.add(name)

    return {
      name,
      image,
      sortOrder: has(item, "sortOrder") ? parseSortOrder(item.sortOrder, `products[${index}].sortOrder`) : index,
    }
  })
}

function buildData(body, { partial }) {
  const data = {}

  for (const field of STRING_FIELDS) {
    if (!partial || has(body, field)) data[field] = toTrimmedString(body[field])
  }

  if (!partial || has(body, "bullets")) data.bullets = toStringArray(body.bullets)
  if (!partial || has(body, "published")) data.published = toBoolean(body.published, true)
  if (has(body, "sortOrder")) data.sortOrder = parseSortOrder(body.sortOrder)

  return data
}

/** key соответствует полю id в SOLUTIONS из src/lib/site.ts. */
async function ensureUniqueKey(base, excludeId = null) {
  const root = slugify(base, "solution")
  let candidate = root
  let suffix = 2

  for (;;) {
    const existing = await prisma.solution.findUnique({ where: { key: candidate } })
    if (!existing || existing.id === excludeId) return candidate
    candidate = `${root}-${suffix}`
    suffix += 1
  }
}

async function findByIdOrKey(idOrKey) {
  return prisma.solution.findFirst({
    where: { OR: [{ id: idOrKey }, { key: idOrKey }] },
    include: WITH_PRODUCTS,
  })
}

// @desc    Get solutions
// @route   GET /api/solutions?published=all
// @access  Public (черновики — только админу)
export const getSolutions = asyncHandler(async (req, res) => {
  const admin = isAdmin(req)
  const { page, limit, skip } = parsePagination(req.query)
  const where = publishedFilter(req.query, admin)

  const [items, total] = await Promise.all([
    prisma.solution.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: WITH_PRODUCTS,
    }),
    prisma.solution.count({ where }),
  ])

  res.json({ items, pagination: buildPagination({ page, limit, total }) })
})

// @desc    Get solution by id or key
// @route   GET /api/solutions/:idOrKey
// @access  Public (черновики — только админу)
export const getSolution = asyncHandler(async (req, res) => {
  const solution = await findByIdOrKey(req.params.idOrKey)

  if (!solution || (!solution.published && !isAdmin(req))) {
    res.status(404)
    throw new Error("Solution not found")
  }

  res.json(solution)
})

// @desc    Create solution
// @route   POST /api/solutions
// @access  Private (Admin)
export const createSolution = asyncHandler(async (req, res) => {
  const missing = missingFields(req.body, REQUIRED_FIELDS)
  if (missing.length > 0) {
    throw badRequest(`Missing or empty required fields: ${missing.join(", ")}`)
  }

  const data = buildData(req.body, { partial: false })
  data.key = await ensureUniqueKey(toTrimmedString(req.body.key) || data.kicker || data.title)

  if (!has(req.body, "sortOrder")) {
    data.sortOrder = await nextSortOrder(prisma.solution)
  }

  if (has(req.body, "products")) {
    data.products = { create: normalizeProducts(req.body.products) }
  }

  const solution = await prisma.solution.create({ data, include: WITH_PRODUCTS })

  res.status(201).json(solution)
})

// @desc    Update solution (products заменяются целиком, если переданы)
// @route   PUT /api/solutions/:idOrKey
// @access  Private (Admin)
export const updateSolution = asyncHandler(async (req, res) => {
  const existing = await findByIdOrKey(req.params.idOrKey)

  if (!existing) {
    res.status(404)
    throw new Error("Solution not found")
  }

  const data = buildData(req.body, { partial: true })

  for (const field of REQUIRED_FIELDS) {
    if (has(req.body, field) && !data[field]) {
      throw badRequest(`Field "${field}" must be a non-empty string`)
    }
  }

  if (has(req.body, "key")) {
    data.key = await ensureUniqueKey(toTrimmedString(req.body.key) || existing.key, existing.id)
  }

  if (has(req.body, "products")) {
    const products = normalizeProducts(req.body.products)
    const keepNames = products.map((item) => item.name)

    // Сохраняем id у уже существующих позиций: upsert по паре
    // (направление + имя), лишние удаляем.
    data.products = {
      deleteMany: keepNames.length > 0 ? { name: { notIn: keepNames } } : {},
      upsert: products.map((item) => ({
        where: { solutionId_name: { solutionId: existing.id, name: item.name } },
        create: item,
        update: { image: item.image, sortOrder: item.sortOrder },
      })),
    }
  }

  const solution = await prisma.solution.update({
    where: { id: existing.id },
    data,
    include: WITH_PRODUCTS,
  })

  res.json(solution)
})

// @desc    Delete solution (вместе с вложенными товарами-примерами)
// @route   DELETE /api/solutions/:idOrKey
// @access  Private (Admin)
export const deleteSolution = asyncHandler(async (req, res) => {
  const existing = await findByIdOrKey(req.params.idOrKey)

  if (!existing) {
    res.status(404)
    throw new Error("Solution not found")
  }

  await prisma.solution.delete({ where: { id: existing.id } })

  res.json({ message: "Solution deleted successfully", id: existing.id })
})
