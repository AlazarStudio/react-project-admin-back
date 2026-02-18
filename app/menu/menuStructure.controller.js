import asyncHandler from "express-async-handler"
import { prisma } from "../prisma.js"

// @desc    Get structure
// @route   GET /api/menuStructure
// @access  Private
export const getMenuStructure = asyncHandler(async (req, res) => {
  // Ищем единственный документ или создаем его, если не существует
  let structure = await prisma.menuStructure.findFirst()
  
  if (!structure) {
    // Создаем новый документ с пустым значением для fields
    structure = await prisma.menuStructure.create({
      data: {
        fields: []
      }
    })
  }

  // Возвращаем значение fields из единственного документа
  res.json({ fields: structure.fields || [] })
})

// @desc    Update structure
// @route   PUT /api/menuStructure
// @access  Private
export const updateMenuStructure = asyncHandler(async (req, res) => {
  const { fields } = req.body

  if (!Array.isArray(fields)) {
    res.status(400)
    throw new Error("fields must be an array")
  }

  // Ищем единственный документ или создаем его
  let structure = await prisma.menuStructure.findFirst()
  
  if (!structure) {
    structure = await prisma.menuStructure.create({
      data: {
        fields: fields || []
      }
    })
  } else {
    // Обновляем существующий документ
    structure = await prisma.menuStructure.update({
      where: {
        id: structure.id
      },
      data: {
        fields: fields || []
      }
    })
  }

  res.json({ fields: structure.fields || [] })
})
