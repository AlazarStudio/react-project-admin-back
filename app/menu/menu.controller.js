import asyncHandler from "express-async-handler"
import { prisma } from "../prisma.js"

function getModelClient(prismaClient, baseName) {
  const lower = baseName.toLowerCase()
  const singular = lower.endsWith('s') ? lower.slice(0, -1) : lower
  const candidates = [lower, singular, `${singular}Item`]
  for (const key of candidates) {
    if (prismaClient[key]) return prismaClient[key]
  }
  throw new Error(`Prisma model client not found for resource "${baseName}"`)
}

function sanitizeCreateData(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {}
  const { id, createdAt, updatedAt, ...rest } = payload
  return rest
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function normalizeMenuData(payload, { requireLabelAndUrl = false } = {}) {
  const input = sanitizeCreateData(payload)
  const data = { ...input }

  // Backward compatibility: accept camelCase fields from frontend.
  if (input.isVisible !== undefined && input.is_visible === undefined) {
    data.is_visible = input.isVisible
  }
  if (input.iconType !== undefined && input.icon_type === undefined) {
    data.icon_type = input.iconType
  }
  if (input.isSystem !== undefined && input.is_system === undefined) {
    data.is_system = input.isSystem
  }

  delete data.isVisible
  delete data.iconType
  delete data.isSystem

  if (data.label !== undefined) {
    if (!isNonEmptyString(data.label)) {
      throw new Error("label must be a non-empty string")
    }
    data.label = data.label.trim()
  }

  if (data.url !== undefined) {
    if (!isNonEmptyString(data.url)) {
      throw new Error("url must be a non-empty string")
    }
    data.url = data.url.trim()
  }

  if (requireLabelAndUrl && (!isNonEmptyString(data.label) || !isNonEmptyString(data.url))) {
    throw new Error("label and url are required")
  }

  return data
}

function isSchemaConversionError(error) {
  if (!error || typeof error.message !== "string") return false
  return error.message.includes("Error converting field")
}

async function repairBrokenMenus() {
  const now = new Date()
  await prisma.$runCommandRaw({
    update: "menus",
    updates: [
      {
        q: { $or: [{ label: null }, { label: { $exists: false } }] },
        u: { $set: { label: "Без названия" } },
        multi: true
      },
      {
        q: { $or: [{ url: null }, { url: { $exists: false } }] },
        u: { $set: { url: "/" } },
        multi: true
      },
      {
        q: { createdAt: { $exists: false } },
        u: { $set: { createdAt: now } },
        multi: true
      },
      {
        q: { updatedAt: { $exists: false } },
        u: { $set: { updatedAt: now } },
        multi: true
      }
    ]
  })
}

// @desc    Get all menu (bulk collection)
// @route   GET /api/menu
// @access  Private/Public
export const getMenus = asyncHandler(async (req, res) => {
  const model = getModelClient(prisma, "menu")
  try {
    const items = await model.findMany({
      orderBy: {
        createdAt: "desc"
      }
    })
    return res.json({ items })
  } catch (error) {
    if (!isSchemaConversionError(error)) {
      throw error
    }

    await repairBrokenMenus()

    const items = await model.findMany({
      orderBy: {
        createdAt: "desc"
      }
    })
    return res.json({ items })
  }
})

// @desc    Get single menu
// @route   GET /api/menu/:id
// @access  Private
export const getMenuById = asyncHandler(async (req, res) => {
  const model = getModelClient(prisma, "menu")
  const item = await model.findUnique({
    where: {
      id: req.params.id
    }
  })

  if (!item) {
    res.status(404)
    throw new Error("Menu not found")
  }

  res.json(item)
})

// @desc    Create menu
// @route   POST /api/menu
// @access  Private
export const createMenu = asyncHandler(async (req, res) => {
  const model = getModelClient(prisma, "menu")
  const data = normalizeMenuData(req.body, { requireLabelAndUrl: true })
  const item = await model.create({
    data
  })

  res.status(201).json(item)
})

// @desc    Replace menu collection
// @route   PUT /api/menu
// @access  Private
export const updateMenu = asyncHandler(async (req, res) => {
  const model = getModelClient(prisma, "menu")
  const { items } = req.body

  if (!Array.isArray(items)) {
    res.status(400)
    throw new Error("items must be an array")
  }

  const normalizedItems = items.map((item) => normalizeMenuData(item, { requireLabelAndUrl: true }))

  await model.deleteMany({})

  const createdItems = await Promise.all(
    normalizedItems.map((item) =>
      model.create({
        data: item
      })
    )
  )

  res.json({ items: createdItems })
})

// @desc    Delete menu
// @route   DELETE /api/menu/:id
// @access  Private
export const deleteMenu = asyncHandler(async (req, res) => {
  const model = getModelClient(prisma, "menu")
  const item = await model.findUnique({
    where: {
      id: req.params.id
    }
  })

  if (!item) {
    res.status(404)
    throw new Error("Menu not found")
  }

  await model.delete({
    where: {
      id: req.params.id
    }
  })

  res.json({ message: "Menu deleted" })
})
