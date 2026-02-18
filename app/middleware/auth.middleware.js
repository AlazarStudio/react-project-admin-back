import asyncHandler from "express-async-handler"
import jwt from "jsonwebtoken"

import { prisma } from "../prisma.js"
import { UserFields } from "../utils/user.utils.js"

// Role-based access control middleware
export const admin = asyncHandler(async (req, res, next) => {
  if (req.user && req.user.role === "SUPERADMIN") {
    next()
  } else {
    res.status(403)
    throw new Error("Not authorized as an admin")
  }
})

export const protect = asyncHandler(async (req, res, next) => {
  let token

  if (req.headers.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1]
  }

  if (!token) {
    res.status(401)
    throw new Error("Not authorized, no token provided")
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    const userFound = await prisma.user.findUnique({
      where: {
        id: decoded.userId
      },
      select: UserFields
    })

    if (!userFound) {
      res.status(401)
      throw new Error("Not authorized, user not found")
    }

    req.user = userFound
    next()
  } catch (error) {
    if (
      error.name === "JsonWebTokenError" ||
      error.name === "TokenExpiredError"
    ) {
      res.status(401)
      throw new Error("Not authorized, invalid token")
    }
    throw error
  }
})
