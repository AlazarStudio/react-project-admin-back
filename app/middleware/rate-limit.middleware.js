/**
 * Примитивный лимитер частоты в памяти процесса — без новых зависимостей.
 * Тот же подход, что уже используется на сайте (src/lib → api/lead/route.ts).
 *
 * ВАЖНО: счётчики живут в памяти одного инстанса. При нескольких воркерах
 * (pm2 cluster, несколько подов) лимит применяется к каждому отдельно —
 * для настоящей защиты на проде нужен общий стор (Redis) или лимит на nginx.
 */

const stores = new Map()

function clientKey(req) {
  // req.ip учитывает trust proxy, если он включён переменной TRUST_PROXY.
  return req.ip || req.socket?.remoteAddress || "unknown"
}

/**
 * @param {object}  options
 * @param {string}  options.name       — отдельное пространство счётчиков
 * @param {number}  options.max        — сколько записей допустимо в окне
 * @param {number}  options.windowMs   — длина окна
 * @param {boolean} options.failuresOnly — считать только неуспешные ответы
 *   и обнулять счётчик при успехе. Нужно для входа: админка получает токен
 *   при каждой перезагрузке вкладки, и подсчёт успешных входов упирал
 *   живого администратора в лимит. Защита от перебора пароля сохраняется:
 *   растёт только серия НЕУДАЧ.
 */
export function rateLimit({ name, max, windowMs, message, failuresOnly = false }) {
  if (!stores.has(name)) stores.set(name, new Map())
  const hits = stores.get(name)

  const prune = (now) => {
    if (hits.size <= 5000) return
    for (const [entryKey, times] of hits) {
      if (times.every((time) => now - time >= windowMs)) hits.delete(entryKey)
    }
  }

  const record = (key, now) => {
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs)
    recent.push(now)
    hits.set(key, recent)
  }

  return (req, res, next) => {
    const now = Date.now()
    const key = clientKey(req)

    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs)
    hits.set(key, recent)
    prune(now)

    if (recent.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - recent[0])) / 1000)
      res.setHeader("Retry-After", String(Math.max(retryAfter, 1)))
      res.status(429)
      return next(new Error(message || "Too many requests, please try again later"))
    }

    if (failuresOnly) {
      // Решение принимаем по факту ответа: успех обнуляет серию,
      // ошибка (кроме нашего же 429) — удлиняет её.
      res.on("finish", () => {
        if (res.statusCode < 400) {
          hits.delete(key)
        } else if (res.statusCode !== 429) {
          record(key, Date.now())
        }
      })
    } else {
      record(key, now)
    }

    return next()
  }
}

/** Число из переменной окружения с безопасным значением по умолчанию. */
function envInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

// Подбор пароля к админке: считаем ТОЛЬКО неудачные попытки подряд,
// успешный вход сбрасывает счётчик.
export const loginRateLimit = rateLimit({
  name: "login",
  max: envInt("LOGIN_RATE_LIMIT_MAX", 20),
  windowMs: envInt("LOGIN_RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  message: "Too many failed login attempts, please try again later",
  failuresOnly: true,
})

// Спам заявками. Лимит щедрее, чем на сайте: если сайт проксирует заявки
// со своего сервера, все они приходят с одного IP.
export const leadRateLimit = rateLimit({
  name: "lead",
  max: envInt("LEAD_RATE_LIMIT_MAX", 20),
  windowMs: envInt("LEAD_RATE_LIMIT_WINDOW_MS", 10 * 60 * 1000),
  message: "Too many requests, please try again later",
})
