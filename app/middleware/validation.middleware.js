import asyncHandler from "express-async-handler"

// Simple validation middleware
export const validateRequest = (validations) => {
  return asyncHandler(async (req, res, next) => {
    const errors = []

    for (const validation of validations) {
      const { field, required, minLength, maxLength, isEmail, custom } =
        validation

      const value = req.body[field]

      if (
        required &&
        (!value || (typeof value === "string" && value.trim() === ""))
      ) {
        errors.push(`${field} is required`)
        continue
      }

      if (value) {
        if (minLength && value.length < minLength) {
          errors.push(`${field} must be at least ${minLength} characters`)
        }

        if (maxLength && value.length > maxLength) {
          errors.push(`${field} must be no more than ${maxLength} characters`)
        }

        if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push(`${field} must be a valid email`)
        }

        if (custom && !custom(value)) {
          errors.push(validation.customError || `${field} is invalid`)
        }
      }
    }

    if (errors.length > 0) {
      res.status(400)
      throw new Error(errors.join(", "))
    }

    next()
  })
}
