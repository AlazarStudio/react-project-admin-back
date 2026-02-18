import asyncHandler from "express-async-handler"
import { prisma } from "../prisma.js"

// @desc    Get all cases
// @route   GET /api/cases
// @access  Private
export const getCasess = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query
  const skip = (parseInt(page) - 1) * parseInt(limit)

  const [cases, total] = await Promise.all([
    prisma.cases.findMany({
      skip,
      take: parseInt(limit),
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.cases.count()
  ])

  res.json({
    cases,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(total / parseInt(limit))
  })
})

// @desc    Get single cases
// @route   GET /api/cases/:id
// @access  Private
export const getCasesById = asyncHandler(async (req, res) => {
  const cases = await prisma.cases.findUnique({
    where: {
      id: req.params.id
    }
  })

  if (!cases) {
    res.status(404)
    throw new Error("Cases not found")
  }

  res.json(cases)
})

// @desc    Create cases
// @route   POST /api/cases
// @access  Private
export const createCases = asyncHandler(async (req, res) => {
  const cases = await prisma.cases.create({
    data: req.body
  })

  res.status(201).json(cases)
})

// @desc    Update cases
// @route   PUT /api/cases/:id
// @access  Private
export const updateCases = asyncHandler(async (req, res) => {
  const cases = await prisma.cases.findUnique({
    where: {
      id: req.params.id
    }
  })

  if (!cases) {
    res.status(404)
    throw new Error("Cases not found")
  }

  const updatedCases = await prisma.cases.update({
    where: {
      id: req.params.id
    },
    data: req.body
  })

  res.json(updatedCases)
})

// @desc    Delete cases
// @route   DELETE /api/cases/:id
// @access  Private
export const deleteCases = asyncHandler(async (req, res) => {
  const cases = await prisma.cases.findUnique({
    where: {
      id: req.params.id
    }
  })

  if (!cases) {
    res.status(404)
    throw new Error("Cases not found")
  }

  await prisma.cases.delete({
    where: {
      id: req.params.id
    }
  })

  res.json({ message: "Cases deleted" })
})
