// Блочная модель статьи блога.
//
// sections — это последовательность блоков, каждый со своим `type`. Раньше
// секция была жёсткой: «заголовок + абзацы + список + таблица». Теперь блоки
// добавляются выбором типа, как в стандартной админке студии.
//
// Старый формат ({ id, title, paragraphs?, bullets?, table? }) продолжает
// приниматься и разворачивается в последовательность блоков — это позволяет
// выкатывать фронт и бэкенд независимо и не ломает три статьи, уже лежащие
// в базе.
//
// Тексты ошибок называют индекс блока и его тип: админка показывает их
// человеку и переводит по этой схеме.

import {
  badRequest,
  dropTrailingEmpty,
  fitRowToColumns,
  slugify,
  toCellArray,
  toStringArray,
  toTrimmedString,
} from "../utils/http.utils.js"

export const BLOCK_TYPES = [
  "heading",
  "text",
  "list",
  "table",
  "quote",
  "image",
  "gallery",
  "video",
  "file",
  "accordion",
]

const TYPE_LIST = BLOCK_TYPES.join(", ")

/** Префикс сообщения об ошибке: индекс блока и, если известен, его тип. */
function label(index, type) {
  return type ? `sections[${index}] (type "${type}")` : `sections[${index}]`
}

function requireText(value, where, field) {
  const text = toTrimmedString(value)
  if (!text) {
    throw badRequest(`${where}: "${field}" is required and must be a non-empty string`)
  }
  return text
}

/** Необязательная строка: пустую не сохраняем, чтобы не плодить "" в jsonb. */
function optionalText(value) {
  return toTrimmedString(value) || undefined
}

function requireList(value, where, field) {
  const items = toStringArray(value)
  if (items.length === 0) {
    throw badRequest(`${where}: "${field}" must contain at least one non-empty string`)
  }
  return items
}

function requireObjectList(value, where, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest(`${where}: "${field}" must be a non-empty array`)
  }
  return value
}

/**
 * Таблица: ячейки ПОЗИЦИОННЫ. Пустая ячейка внутри строки сохраняется, строка
 * выравнивается по числу заголовков (row.length === headers.length). Иначе
 * пустая ячейка выпадала бы и остальные столбцы съезжали под чужие заголовки.
 *
 * Читает headers/rows прямо с переданного объекта: у блока `table` они лежат
 * на самом блоке, у старой секции — во вложенном `table`.
 */
export function normalizeTable(source, where) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw badRequest(`${where}: table must be an object with "headers" and "rows"`)
  }

  const headers = dropTrailingEmpty(toCellArray(source.headers))

  const rawRows = Array.isArray(source.rows) ? source.rows : []
  const rows = rawRows
    .map((row) => {
      const cells = dropTrailingEmpty(toCellArray(row))
      return headers.length > 0 ? fitRowToColumns(cells, headers.length) : cells
    })
    // Полностью пустая строка — мусор из редактора, а не данные.
    .filter((row) => row.some((cell) => cell !== ""))

  return { headers, rows }
}

/**
 * Уровень заголовка внутри статьи.
 * H1 занят главным заголовком страницы, поэтому разделу доступен только H2,
 * а подзаголовку внутри раздела — H3. Иная глубина ломает SEO-иерархию.
 */
const HEADING_LEVELS = [2, 3]
const DEFAULT_HEADING_LEVEL = 2

/** Поля блока по его типу. `id` и `type` добавляются снаружи. */
const BUILDERS = {
  heading: (raw, where) => {
    const block = { text: requireText(raw.text, where, "text") }

    // Поле необязательное. Отсутствие означает уровень 2, и в этом случае
    // ничего не сохраняем — незачем плодить значение по умолчанию в jsonb.
    if (raw.level !== undefined) {
      if (!HEADING_LEVELS.includes(raw.level)) {
        throw badRequest(
          `${where}: "level" must be one of: ${HEADING_LEVELS.join(", ")} ` +
            `(H1 is reserved for the page title; omit the field for ${DEFAULT_HEADING_LEVEL})`
        )
      }
      block.level = raw.level
    }

    return block
  },

  text: (raw, where) => ({
    paragraphs: requireList(raw.paragraphs, where, "paragraphs"),
  }),

  list: (raw, where) => {
    const block = { items: requireList(raw.items, where, "items") }
    if (raw.ordered !== undefined) {
      if (typeof raw.ordered !== "boolean") {
        throw badRequest(`${where}: "ordered" must be a boolean`)
      }
      block.ordered = raw.ordered
    }
    return block
  },

  table: (raw, where) => {
    const { headers, rows } = normalizeTable(raw, where)
    if (headers.length === 0) {
      throw badRequest(`${where}: "headers" must contain at least one column`)
    }
    const block = { headers, rows }
    const caption = optionalText(raw.caption)
    if (caption) block.caption = caption
    return block
  },

  quote: (raw, where) => {
    const block = { text: requireText(raw.text, where, "text") }
    const author = optionalText(raw.author)
    if (author) block.author = author
    return block
  },

  image: (raw, where) => {
    const block = {
      src: requireText(raw.src, where, "src"),
      alt: requireText(raw.alt, where, "alt"),
    }
    const caption = optionalText(raw.caption)
    if (caption) block.caption = caption
    return block
  },

  gallery: (raw, where) => {
    const images = requireObjectList(raw.images, where, "images").map((image, imageIndex) => {
      if (!image || typeof image !== "object" || Array.isArray(image)) {
        throw badRequest(`${where}: images[${imageIndex}] must be an object with "src" and "alt"`)
      }
      const at = `${where} images[${imageIndex}]`
      return {
        src: requireText(image.src, at, "src"),
        alt: requireText(image.alt, at, "alt"),
      }
    })
    return { images }
  },

  video: (raw, where) => {
    const block = { src: requireText(raw.src, where, "src") }
    const poster = optionalText(raw.poster)
    if (poster) block.poster = poster
    const caption = optionalText(raw.caption)
    if (caption) block.caption = caption
    return block
  },

  file: (raw, where) => ({
    url: requireText(raw.url, where, "url"),
    title: requireText(raw.title, where, "title"),
  }),

  accordion: (raw, where) => {
    const items = requireObjectList(raw.items, where, "items").map((item, itemIndex) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw badRequest(`${where}: items[${itemIndex}] must be an object with "question" and "answer"`)
      }
      const at = `${where} items[${itemIndex}]`
      return {
        question: requireText(item.question, at, "question"),
        answer: requireText(item.answer, at, "answer"),
      }
    })
    return { items }
  },
}

function buildBlock(raw, index) {
  const type = toTrimmedString(raw.type)
  if (!type) {
    throw badRequest(`${label(index)}: "type" is required. Allowed types: ${TYPE_LIST}`)
  }

  const builder = BUILDERS[type]
  if (!builder) {
    throw badRequest(`${label(index)}: unknown block type "${type}". Allowed types: ${TYPE_LIST}`)
  }

  const where = label(index, type)
  const id = requireText(raw.id, where, "id")

  return { id, type, ...builder(raw, where) }
}

/**
 * Старая секция → последовательность блоков.
 * `id` исходной секции достаётся заголовку (он и был якорем), остальным
 * блокам выдаются производные идентификаторы.
 */
function expandLegacySection(raw, index) {
  const where = `${label(index)} (legacy format)`
  const title = requireText(raw.title, where, "title")
  const baseId = toTrimmedString(raw.id) || slugify(title, `section-${index + 1}`)

  const blocks = [{ id: baseId, type: "heading", text: title }]

  const paragraphs = toStringArray(raw.paragraphs)
  if (paragraphs.length > 0) {
    blocks.push({ id: `${baseId}-text`, type: "text", paragraphs })
  }

  const items = toStringArray(raw.bullets)
  if (items.length > 0) {
    blocks.push({ id: `${baseId}-list`, type: "list", items })
  }

  if (raw.table && typeof raw.table === "object") {
    const { headers, rows } = normalizeTable(raw.table, `${where} table`)
    if (headers.length === 0) {
      throw badRequest(`${where}: table requires at least one column in "headers"`)
    }
    blocks.push({ id: `${baseId}-table`, type: "table", headers, rows })
  }

  return blocks
}

/**
 * Приводит sections к массиву блоков.
 * Принимает и блочный формат, и старый — смешанный массив тоже допустим.
 */
export function normalizeSections(value) {
  if (!Array.isArray(value)) {
    throw badRequest("sections must be an array")
  }

  const blocks = []

  value.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw badRequest(`${label(index)} must be an object`)
    }

    // Старый формат узнаём по отсутствию type при наличии title.
    if (raw.type === undefined && toTrimmedString(raw.title)) {
      blocks.push(...expandLegacySection(raw, index))
      return
    }

    blocks.push(buildBlock(raw, index))
  })

  const seen = new Set()
  for (const block of blocks) {
    if (seen.has(block.id)) {
      throw badRequest(
        `sections: duplicate block id "${block.id}" — ids must be unique within an article`
      )
    }
    seen.add(block.id)
  }

  return blocks
}
