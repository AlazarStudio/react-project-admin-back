import { hash } from "argon2"
import asyncHandler from "express-async-handler"

import { prisma } from "../prisma.js"
import { UserFields } from "../utils/user.utils.js"

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
export const getUserProfile = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: {
      id: req.user.id
    },
    select: UserFields
  })

  res.json(user)
})

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
export const updateUserProfile = asyncHandler(async (req, res) => {
  const { name, email, password, userInformation } = req.body

  const updateData = {}

  if (name) updateData.name = name
  if (email) {
    const existingUser = await prisma.user.findUnique({
      where: { email }
    })
    if (existingUser && existingUser.id !== req.user.id) {
      res.status(400)
      throw new Error("Email already in use")
    }
    updateData.email = email
  }
  if (password) {
    if (password.length < 6) {
      res.status(400)
      throw new Error("Password must be at least 6 characters")
    }
    updateData.password = await hash(password)
  }
  if (userInformation) updateData.userInformation = userInformation

  const updatedUser = await prisma.user.update({
    where: {
      id: req.user.id
    },
    data: updateData,
    select: UserFields
  })

  res.json(updatedUser)
})
