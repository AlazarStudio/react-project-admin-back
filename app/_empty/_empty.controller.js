import asyncHandler from "express-async-handler"

import { prisma } from "../prisma.js"

// @desc    Get _emptys with pagination
// @route   GET /api/_emptys?page=1&limit=10
// @access  Private
export const get_Emptys = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 10
  const skip = (page - 1) * limit

  const [items, total] = await Promise.all([
    prisma._empty.findMany({
      skip,
      take: limit,
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma._empty.count()
  ])

  res.json({
    items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  })
})

// @desc    Get _empty by id
// @route   GET /api/_emptys/:id
// @access  Private
export const get_Empty = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id)

  if (isNaN(id)) {
    res.status(400)
    throw new Error("Invalid ID")
  }

  const _empty = await prisma._empty.findUnique({
    where: { id }
  })

  if (!_empty) {
    res.status(404)
    throw new Error("_Empty not found")
  }

  res.json(_empty)
})

// @desc    Create new _empty
// @route   POST /api/_emptys
// @access  Private
export const createNew_Empty = asyncHandler(async (req, res) => {
  // TODO: Добавьте поля из req.body
  // Пример: const { field1, field2 } = req.body

  const _empty = await prisma._empty.create({
    data: {
      // TODO: Добавьте поля для создания
      // Пример: field1, field2
    }
  })

  res.status(201).json(_empty)
})

// @desc    Update _empty
// @route   PUT /api/_emptys/:id
// @access  Private
export const update_Empty = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id)

  if (isNaN(id)) {
    res.status(400)
    throw new Error("Invalid ID")
  }

  // TODO: Добавьте поля из req.body
  // Пример: const { field1, field2 } = req.body

  // Проверка существования записи
  const existing = await prisma._empty.findUnique({
    where: { id }
  })

  if (!existing) {
    res.status(404)
    throw new Error("_Empty not found")
  }

  // TODO: Добавьте логику проверки прав доступа (если нужно)
  // Пример: if (existing.userId !== req.user.id) { ... }

  const updateData = {}
  // TODO: Добавьте поля для обновления
  // Пример: if (field1) updateData.field1 = field1

  const _empty = await prisma._empty.update({
    where: { id },
    data: updateData
  })

  res.json(_empty)
})

// @desc    Delete _empty
// @route   DELETE /api/_emptys/:id
// @access  Private
export const delete_Empty = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id)

  if (isNaN(id)) {
    res.status(400)
    throw new Error("Invalid ID")
  }

  // Проверка существования записи
  const existing = await prisma._empty.findUnique({
    where: { id }
  })

  if (!existing) {
    res.status(404)
    throw new Error("_Empty not found")
  }

  // TODO: Добавьте логику проверки прав доступа (если нужно)
  // Пример: if (existing.userId !== req.user.id) { ... }

  await prisma._empty.delete({
    where: { id }
  })

  res.json({ message: "_Empty deleted successfully" })
})
