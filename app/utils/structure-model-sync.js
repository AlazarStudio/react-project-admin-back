import {
  generatePrismaModel,
  addModelToSchema,
  syncPrisma,
} from "./code-generator.js"

const CYRILLIC_MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
}

function transliterate(value = "") {
  return String(value)
    .split("")
    .map((char) => {
      const lower = char.toLowerCase()
      const mapped = CYRILLIC_MAP[lower]
      if (!mapped) return char
      return char === lower ? mapped : mapped
    })
    .join("")
}

function normalizeFieldKey(raw, fallback = "field") {
  const normalized = transliterate(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")

  const base = normalized || fallback
  if (!/^[a-z]/.test(base)) {
    return `field_${base}`
  }
  return base
}

function mapStructureTypeToPrismaType(type = "") {
  const normalized = String(type).toLowerCase()
  if (normalized === "number") return "Int"
  if (normalized === "boolean") return "Boolean"
  if (normalized === "date") return "DateTime"
  if (normalized === "json") return "Json"
  return "String"
}

export function buildModelFieldsFromStructure(structureFields) {
  const input = Array.isArray(structureFields) ? structureFields : []
  const used = new Set()

  return input
    .filter((field) => field && field.type !== "additionalBlocks")
    .map((field, index) => {
      const order = Number.isFinite(field?.order) ? Number(field.order) : index
      const fallback = `${String(field?.type || "field").toLowerCase()}_${order}`
      const byLabel = normalizeFieldKey(field?.label || "", fallback)

      let uniqueName = byLabel
      let suffix = 1
      while (used.has(uniqueName)) {
        uniqueName = `${byLabel}_${suffix}`
        suffix += 1
      }
      used.add(uniqueName)

      return {
        name: uniqueName,
        type: mapStructureTypeToPrismaType(field?.type),
        required: false,
      }
    })
}

export async function syncResourceModelFromStructure(resourceName, structureFields) {
  const modelFields = buildModelFieldsFromStructure(structureFields)

  if (modelFields.length === 0) {
    return { changed: false, reason: "no_fields", fields: modelFields }
  }

  const prismaModel = generatePrismaModel(resourceName, modelFields)
  const changed = await addModelToSchema(prismaModel)

  if (changed) {
    await syncPrisma()
  }

  return { changed, fields: modelFields }
}
