import asyncHandler from "express-async-handler"
import crypto from "crypto"

/**
 * Совпадает ли заголовок x-api-key с SITE_API_KEY.
 * Сравнение постоянное по времени, чтобы ключ нельзя было подобрать
 * по таймингам. Ничего не бросает — нужен там, где ключ не обязателен,
 * а лишь расширяет объём ответа.
 */
export function hasValidSiteApiKey(req) {
  const expected = process.env.SITE_API_KEY
  const provided = req.headers["x-api-key"]

  if (!expected) return false
  if (typeof provided !== "string" || provided.length === 0) return false

  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(provided)

  return (
    expectedBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, providedBuf)
  )
}

/**
 * Проверка заголовка x-api-key для публичных машинных запросов (приём заявок с
 * сайта). Здесь ключ обязателен: без него — 401.
 */
export const siteApiKey = asyncHandler(async (req, res, next) => {
  if (!process.env.SITE_API_KEY) {
    res.status(500)
    throw new Error("SITE_API_KEY is not configured on the server")
  }

  const provided = req.headers["x-api-key"]

  if (typeof provided !== "string" || provided.length === 0) {
    res.status(401)
    throw new Error("Not authorized, x-api-key header is required")
  }

  if (!hasValidSiteApiKey(req)) {
    res.status(401)
    throw new Error("Not authorized, invalid x-api-key")
  }

  next()
})
