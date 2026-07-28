/**
 * Пересобирает снимок данных сайта в prisma/seed-data.json.
 *
 * Запускается ТОЛЬКО там, где рядом лежат исходники сайта (в разработке).
 * На сервере бэкенд и сайт живут в разных каталогах (/var/www/mayak-api и
 * /var/www/mayak), поэтому сам `npm run seed` читает готовый снимок и в
 * исходники сайта не заглядывает.
 *
 *   npm run seed:export                    # ищет сайт на два уровня вверх
 *   npm run seed:export -- ../../mayak     # явный путь к корню сайта
 *   SITE_ROOT=/var/www/mayak npm run seed:export
 *
 * Требует Node >= 22.18: скрипт импортирует .ts напрямую (стирание типов).
 */

import fs from "fs"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendRoot = path.resolve(__dirname, "..")
const outputPath = path.join(backendRoot, "prisma", "seed-data.json")

const REQUIRED_FILES = ["catalog.ts", "blog.ts", "site.ts", "faq.ts"]

function fail(message, hint) {
  console.error(`\n❌ ${message}`)
  if (hint) console.error(`\n${hint}`)
  process.exit(1)
}

function resolveSiteRoot() {
  const fromArg = process.argv[2]?.trim()
  const fromEnv = process.env.SITE_ROOT?.trim()
  const candidates = [
    fromArg && path.resolve(process.cwd(), fromArg),
    fromEnv && path.resolve(process.cwd(), fromEnv),
    // Стандартная раскладка разработки: бэкенд лежит внутри каталога сайта.
    path.resolve(backendRoot, ".."),
    // Бэкенд рядом с сайтом.
    path.resolve(backendRoot, "..", "mayak"),
  ].filter(Boolean)

  for (const candidate of candidates) {
    const libDir = path.join(candidate, "src", "lib")
    if (REQUIRED_FILES.every((file) => fs.existsSync(path.join(libDir, file)))) {
      return candidate
    }
  }

  fail(
    "Не найдены исходники сайта — снимок собрать не из чего.",
    [
      "Проверены пути:",
      ...candidates.map((c) => `  • ${path.join(c, "src", "lib")}`),
      "",
      `Нужны файлы: ${REQUIRED_FILES.join(", ")}`,
      "",
      "Укажите корень сайта явно:",
      "  npm run seed:export -- /путь/к/сайту",
      "  SITE_ROOT=/путь/к/сайту npm run seed:export",
      "",
      "Если сайта на этой машине нет — пересобирать снимок не нужно:",
      "prisma/seed-data.json лежит в репозитории, и `npm run seed` работает без сайта.",
    ].join("\n")
  )
}

async function importLib(siteRoot, file) {
  const target = path.join(siteRoot, "src", "lib", file)
  try {
    return await import(pathToFileURL(target).href)
  } catch (error) {
    if (error instanceof SyntaxError || /ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension/.test(String(error?.message))) {
      fail(
        `Не удалось выполнить ${file}: текущая версия Node не умеет импортировать TypeScript.`,
        `Нужен Node >= 22.18 (сейчас ${process.version}).\n` +
          "Сам `npm run seed` этого не требует — ограничение только для пересборки снимка."
      )
    }
    fail(`Ошибка при чтении ${target}:\n${error?.stack || error}`)
  }
}

function expect(condition, message) {
  if (!condition) fail(`Снимок не собран: ${message}`)
}

const siteRoot = resolveSiteRoot()
console.log(`📖 Источник: ${path.join(siteRoot, "src", "lib")}`)

const { PRODUCTS } = await importLib(siteRoot, "catalog.ts")
const { BLOG_ARTICLES } = await importLib(siteRoot, "blog.ts")
const { CONTACTS, PROCESS, SOLUTIONS, SOLUTION_PRODUCTS, STATS } = await importLib(siteRoot, "site.ts")
const { FAQ_ITEMS } = await importLib(siteRoot, "faq.ts")

expect(Array.isArray(PRODUCTS) && PRODUCTS.length > 0, "PRODUCTS пуст")
expect(Array.isArray(BLOG_ARTICLES) && BLOG_ARTICLES.length > 0, "BLOG_ARTICLES пуст")
expect(Array.isArray(SOLUTIONS) && SOLUTIONS.length > 0, "SOLUTIONS пуст")
expect(SOLUTION_PRODUCTS && typeof SOLUTION_PRODUCTS === "object", "SOLUTION_PRODUCTS отсутствует")
expect(CONTACTS && Array.isArray(CONTACTS.phones), "CONTACTS.phones отсутствует")
expect(Array.isArray(STATS) && STATS.length > 0, "STATS пуст")
expect(Array.isArray(PROCESS) && PROCESS.length > 0, "PROCESS пуст")
expect(Array.isArray(FAQ_ITEMS) && FAQ_ITEMS.length > 0, "FAQ_ITEMS пуст")

// JSON.parse(JSON.stringify(...)) снимает readonly с `as const` и гарантирует,
// что в снимок попадут только сериализуемые значения.
const plain = (value) => JSON.parse(JSON.stringify(value))

const snapshot = {
  $comment:
    "Снимок данных сайта для prisma/seed.js. Не редактируйте вручную — пересоберите: npm run seed:export",
  generatedAt: new Date().toISOString(),
  source: "src/lib/{catalog,blog,site}.ts",
  products: plain(PRODUCTS),
  articles: plain(BLOG_ARTICLES),
  solutions: plain(SOLUTIONS),
  solutionProducts: plain(SOLUTION_PRODUCTS),
  contacts: plain(CONTACTS),
  stats: plain(STATS),
  process: plain(PROCESS),
  // В исходниках сайта поля короткие (q/a) — в снимке и в базе они
  // называются по-человечески, чтобы их было понятно править в панели.
  faq: plain(FAQ_ITEMS).map((item) => ({ question: item.q, answer: item.a })),
}

fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf-8")

const solutionProductCount = Object.values(snapshot.solutionProducts).reduce(
  (sum, list) => sum + list.length,
  0
)

console.log(`💾 Снимок записан: ${path.relative(backendRoot, outputPath)}`)
console.log(
  `   товаров ${snapshot.products.length}, статей ${snapshot.articles.length}, ` +
    `направлений ${snapshot.solutions.length} (позиций ${solutionProductCount}), ` +
    `показателей ${snapshot.stats.length}, этапов ${snapshot.process.length}, ` +
    `вопросов ${snapshot.faq.length}, телефонов ${snapshot.contacts.phones.length}`
)
console.log("\nНе забудьте закоммитить prisma/seed-data.json.")
