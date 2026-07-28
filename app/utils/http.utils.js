// Общие помощники для контент-ресурсов: пагинация, нормализация полей, slug.

export const INT32_MIN = -2147483648
export const INT32_MAX = 2147483647

/** Только десятичные цифры: без знака, экспоненты и дробной части. */
const STRICT_UINT = /^\d+$/

const CYRILLIC_MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
}

/** Ошибка с HTTP-статусом: errorHandler читает statusCode и не отдаёт 500. */
export function httpError(status, message) {
  return Object.assign(new Error(message), { statusCode: status })
}

export function badRequest(message) {
  return httpError(400, message)
}

/** Транслитерация кириллицы в латиницу для генерации slug. */
export function transliterate(value = "") {
  return String(value)
    .split("")
    .map((char) => {
      const lower = char.toLowerCase()
      const mapped = CYRILLIC_MAP[lower]
      return mapped === undefined ? char : mapped
    })
    .join("")
}

/** Приводит произвольную строку к безопасному slug (латиница, цифры, дефис). */
export function slugify(value = "", fallback = "item") {
  const slug = transliterate(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug || fallback
}

/**
 * Разбирает query-параметры пагинации.
 * Если ни page, ни limit не переданы — отдаём весь список (в пределах maxLimit),
 * чтобы сайт мог одним запросом получить весь каталог.
 */
/**
 * Строгий разбор положительного целого из query.
 * Именно строгий: parseInt("1e9") молча возвращал 1, а parseInt("5abc") — 5,
 * из-за чего кривой параметр не отвергался, а тихо подменялся другим числом.
 * Правило одно для всех числовых параметров запроса.
 */
export function getPositiveIntParam(query, key) {
  const raw = query?.[key]
  if (raw === undefined || raw === null) return null

  if (typeof raw !== "string") {
    throw badRequest(`Query parameter "${key}" must be a string`)
  }

  const trimmed = raw.trim()
  if (!STRICT_UINT.test(trimmed)) {
    throw badRequest(`Query parameter "${key}" must be a positive integer`)
  }

  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value < 1 || value > INT32_MAX) {
    throw badRequest(
      `Query parameter "${key}" must be a positive integer between 1 and ${INT32_MAX}`
    )
  }

  return value
}

export function parsePagination(query = {}, { defaultLimit = 100, maxLimit = 500 } = {}) {
  const page = getPositiveIntParam(query, "page") ?? 1
  const requestedLimit = getPositiveIntParam(query, "limit")

  const limit = requestedLimit === null
    ? Math.min(defaultLimit, maxLimit)
    : Math.min(requestedLimit, maxLimit)

  return { page, limit, skip: (page - 1) * limit }
}

export function buildPagination({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    pages: limit > 0 ? Math.ceil(total / limit) : 0,
  }
}

/**
 * Значение query-параметра строкой.
 * `?type[contains]=x` приходит объектом — молча игнорировать такое нельзя,
 * иначе фильтр «пропадает» и клиент получает весь список вместо выборки.
 */
export function getStringParam(query, key) {
  const value = query?.[key]
  if (value === undefined || value === null) return ""
  if (typeof value !== "string") {
    throw badRequest(`Query parameter "${key}" must be a string`)
  }
  return value.trim()
}

/**
 * Экранирует спецсимволы LIKE/ILIKE. Без этого `?search=%` возвращает вообще
 * всё, а `_` совпадает с любым одиночным символом.
 */
export function escapeLike(value = "") {
  return String(value).replace(/[\\%_]/g, (char) => `\\${char}`)
}

/** Строка поиска для Prisma `contains` — уже экранированная. */
export function getSearchParam(query, key = "search") {
  const raw = getStringParam(query, key)
  return raw ? escapeLike(raw) : ""
}

/** true, если ключ реально присутствует в теле запроса. */
export function has(body, key) {
  return Boolean(body) && Object.prototype.hasOwnProperty.call(body, key)
}

export function toTrimmedString(value) {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Массив непустых строк — для НЕпозиционных списков: теги, опции,
 * комплектация, буллиты, абзацы, ключевые слова, телефоны.
 *
 * Разделитель — ТОЛЬКО перевод строки: пункты комплектации и буллиты сплошь
 * содержат запятые («Электрика под обогреватель: автомат, розетки, свет»),
 * и разбиение по запятой разрушало бы их при каждом сохранении из админки.
 *
 * Пустые элементы отбрасываются сознательно: у такого списка нет позиционной
 * привязки, а лишний перевод строки в textarea не должен превращаться
 * в пустой абзац или пустой пункт списка.
 *
 * ВНИМАНИЕ: для позиционных структур (ячейки таблицы) использовать НЕЛЬЗЯ —
 * там пустое значение значимо. См. toCellArray().
 */
export function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cellToString(item)).filter(Boolean)
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function cellToString(value) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}

/**
 * Ячейки строки/шапки таблицы. В отличие от toStringArray НИЧЕГО не выбрасывает:
 * позиция ячейки привязана к номеру столбца, и пустая ячейка — легальное
 * значение. Раньше здесь работал filter(Boolean), из-за чего пустая ячейка
 * в середине строки исчезала, а все последующие столбцы съезжали под чужие
 * заголовки — то есть данные молча портились.
 *
 * Принимает оба формата: массив ячеек (новый фронт админки) и склеенную
 * переводами строк строку (старый формат).
 */
export function toCellArray(value) {
  if (Array.isArray(value)) return value.map(cellToString)
  if (typeof value === "string") return value.split(/\r?\n/).map((item) => item.trim())
  if (value === null || value === undefined) return []
  return [cellToString(value)]
}

/**
 * Убирает только ХВОСТОВЫЕ пустые ячейки — это артефакт лишнего перевода
 * строки в конце поля. Пустые ячейки в начале и середине сохраняются.
 */
export function dropTrailingEmpty(cells) {
  const next = [...cells]
  while (next.length > 0 && next[next.length - 1] === "") next.pop()
  return next
}

/** Приводит строку таблицы к числу столбцов: лишнее режем, недостающее добиваем "". */
export function fitRowToColumns(cells, columns) {
  if (!Number.isInteger(columns) || columns <= 0) return cells
  const next = cells.slice(0, columns)
  while (next.length < columns) next.push("")
  return next
}

export function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value
  if (value === "true" || value === 1 || value === "1") return true
  if (value === "false" || value === 0 || value === "0") return false
  return fallback
}

// toInt() удалён намеренно: «распарсить, а при мусоре молча подставить
// значение по умолчанию» — ровно тот footgun, из-за которого ?page=1e9
// превращалось в 1, а sortOrder="abc" в 0. Используйте getPositiveIntParam()
// или parseSortOrder(): они отвергают некорректный ввод с 400.

/**
 * sortOrder: целое в границах int32.
 * Иначе "abc" молча превращался в 0, а 99999999999999 ронял запрос
 * сырой ошибкой Prisma с кодом 500.
 */
export function parseSortOrder(value, field = "sortOrder") {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw badRequest(`"${field}" must be an integer`)
  } else if (typeof value === "string") {
    if (!/^-?\d+$/.test(value.trim())) throw badRequest(`"${field}" must be an integer`)
  } else {
    throw badRequest(`"${field}" must be an integer`)
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < INT32_MIN || parsed > INT32_MAX) {
    throw badRequest(`"${field}" must be an integer between ${INT32_MIN} and ${INT32_MAX}`)
  }

  return parsed
}

/**
 * Следующее значение автонумерации, гарантированно влезающее в int32.
 *
 * Раньше считалось «последний + 1» без потолка: админ выставлял вполне
 * легальный sortOrder = 2147483647, и следующее создание записи падало 500
 * («Unable to fit integer value '2147483648' into an INT4») — раздел ломался
 * навсегда. Упираемся в INT32_MAX: новые записи всё равно создаются и
 * оказываются в конце списка, а ничью разрешает вторичная сортировка.
 */
export function nextSortOrderValue(lastSortOrder) {
  const base = Number.isInteger(lastSortOrder) ? lastSortOrder : -1
  if (base >= INT32_MAX) return INT32_MAX
  return base + 1
}

/** Автонумерация для любой модели Prisma с полем sortOrder. */
export async function nextSortOrder(model) {
  const last = await model.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  })
  return nextSortOrderValue(last?.sortOrder)
}

/**
 * Локальный путь до файла на нашем же origin: ровно один ведущий «/».
 *
 * Внешние адреса не принимаем сознательно: на сайте картинки рисует
 * next/image, и любой домен, не прописанный в next.config, роняет страницу.
 * Заодно отсекаются протокол-относительные «//evil.com» и «/\evil.com» —
 * часть парсеров и браузеров читает их как внешний хост.
 */
export function isLocalAssetPath(value) {
  if (typeof value !== "string") return false

  const path = value.trim()
  if (!path.startsWith("/")) return false
  if (path.startsWith("//")) return false
  if (path.startsWith("/\\")) return false

  return true
}

/**
 * Строгий boolean: никаких «мягких» приведений.
 *
 * Строка "false" в JS истинна, и однажды пропущенная мягкая проверка включила
 * бы флаг вопреки настройке. Поэтому принимаем только настоящие true/false.
 */
export function requireBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw badRequest(`"${field}" must be a boolean (true or false), not a string`)
  }
  return value
}

/** Предел длины описания изображения. */
export const MAX_ALT_LENGTH = 300

/**
 * Описание изображения для screen reader'ов.
 * Пустая строка допустима: у декоративной картинки alt должен быть пустым,
 * это осознанный приём доступности, а не недозаполненные данные.
 */
export function normalizeAlt(value, where = '"alt"') {
  if (value === undefined || value === null) return ""

  if (typeof value !== "string") {
    throw badRequest(`${where} must be a string`)
  }

  const alt = value.trim()
  if (alt.length > MAX_ALT_LENGTH) {
    throw badRequest(
      `${where} must be no longer than ${MAX_ALT_LENGTH} characters, got ${alt.length}`
    )
  }

  return alt
}

/** Валидная дата или null. */
export function toDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Список отсутствующих обязательных полей.
 * Обязательным считается непустая СТРОКА: раньше `{"name": 12345}` проходило
 * проверку, а toTrimmedString затем превращало число в "" — и в каталоге
 * появлялась запись с пустым названием.
 */
export function missingFields(body, fields) {
  return fields.filter((field) => !toTrimmedString(body?.[field]))
}
