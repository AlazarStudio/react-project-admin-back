export const notFound = (req, res, next) => {
  const error = new Error(`Not found - ${req.originalUrl}`)
  res.status(404)
  next(error)
}

export const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode
  
  // Если ответ уже отправлен, не пытаемся отправить его снова
  if (res.headersSent) {
    return next(err)
  }
  
  res.status(statusCode)
  res.json({
    success: false,
    message: err.message,
    error: err.message,
    stack: process.env.NODE_ENV === "production" ? null : err.stack
  })
}
