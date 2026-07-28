export const notFound = (req, res, next) => {
  const error = new Error(`Not found - ${req.originalUrl}`)
  res.status(404)
  next(error)
}

/** multer сообщает о превышении лимитов кодом, а не HTTP-статусом. */
const MULTER_STATUS = {
  LIMIT_FILE_SIZE: 413,
  LIMIT_PART_COUNT: 413,
  LIMIT_FIELD_KEY: 413,
  LIMIT_FIELD_VALUE: 413,
  LIMIT_FIELD_COUNT: 413,
  LIMIT_FILE_COUNT: 400,
  LIMIT_UNEXPECTED_FILE: 400,
}

/**
 * Коды Prisma, которым соответствует вина клиента, а не сервера.
 * Всё остальное от Prisma — 500, но с обезличенным текстом: наружу не должны
 * улетать имена таблиц, куски SQL и прочие внутренности.
 */
const PRISMA_ERRORS = {
  P2000: [400, "Value is too long for one of the fields"],
  P2002: [409, "Record with these unique values already exists"],
  P2003: [409, "Related record is missing or still referenced"],
  P2011: [400, "Required field cannot be null"],
  P2012: [400, "Missing required value"],
  P2019: [400, "Invalid input value"],
  P2020: [400, "Value is out of range for its field"],
  P2025: [404, "Record not found"],
  P2033: [400, "Number is out of range for its field"],
}

function isPrismaError(err) {
  return typeof err?.name === "string" && err.name.startsWith("PrismaClient")
}

/** Ошибка Prisma → [status, безопасное сообщение]. */
function mapPrismaError(err) {
  const known = PRISMA_ERRORS[err?.code]
  if (known) return known

  if (err?.name === "PrismaClientValidationError") {
    return [400, "Invalid request data"]
  }

  // Переполнение целого прилетает как ошибка драйвера с сырым текстом
  // «Unable to fit integer value ... into an INT4» — переводим в 400.
  if (/unable to fit integer value/i.test(err?.message || "")) {
    return [400, "Numeric value is out of range for its field"]
  }

  return [500, "Database request failed"]
}

function normalizeStatus(value) {
  const status = Number(value)
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : null
}

function resolveStatus(err, res) {
  // Статус, который контроллер выставил явно через res.status(...)
  const fromResponse = normalizeStatus(res.statusCode)
  if (fromResponse) return fromResponse

  // Ошибки body-parser (битый JSON → 400, слишком большое тело → 413)
  // и наши httpError() приходят со статусом на самом объекте ошибки.
  const fromError = normalizeStatus(err?.statusCode ?? err?.status)
  if (fromError) return fromError

  if (err?.name === "MulterError") {
    return MULTER_STATUS[err.code] || 400
  }

  return 500
}

export const errorHandler = (err, req, res, next) => {
  // Если ответ уже отправлен, не пытаемся отправить его снова
  if (res.headersSent) {
    return next(err)
  }

  let statusCode = resolveStatus(err, res)
  let message = err.message

  // Сырая ошибка Prisma не должна доходить до клиента ни при каких условиях.
  if (isPrismaError(err)) {
    const [prismaStatus, prismaMessage] = mapPrismaError(err)
    // Явный статус из контроллера (res.status(...)) уважаем, иначе берём наш.
    if (!normalizeStatus(res.statusCode)) statusCode = prismaStatus
    message = prismaMessage
  }

  // Детали 5xx наружу не отдаём: клиенту незачем знать внутренности,
  // а в логах сервера полный стек остаётся.
  const isServerError = statusCode >= 500
  if (isServerError) {
    console.error("❌", req.method, req.originalUrl, err)
    if (process.env.NODE_ENV === "production") message = "Internal server error"
  }

  res.status(statusCode)
  res.json({
    success: false,
    message,
    error: message,
    stack: process.env.NODE_ENV === "production" ? null : err.stack
  })
}
