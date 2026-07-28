// Наполнение БД реальными данными сайта ООО «Маяк».
//
// Данные берутся из снимка prisma/seed-data.json, который лежит В РЕПОЗИТОРИИ
// бэкенда. Раньше здесь был прямой импорт исходников сайта (../../src/lib/*.ts),
// но на сервере бэкенд и сайт разнесены по разным каталогам
// (/var/www/mayak-api и /var/www/mayak), путь не разрешался, и установка падала
// на сиде — а вместе с контентом не создавался и администратор.
//
// Снимок пересобирается отдельной командой там, где сайт есть под рукой:
//   npm run seed:export
//
// Скрипт идемпотентен: повторный запуск обновляет контент, но НЕ трогает
// учётку администратора и не меняет id уже существующих записей.

// dotenv первым импортом: PrismaClient создаётся на этапе загрузки модуля,
// поэтому DATABASE_URL должен быть в process.env раньше.
import "dotenv/config"

import { hash } from "argon2"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

import { prisma } from "../app/prisma.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SEED_DATA_PATH = path.join(__dirname, "seed-data.json")

function loadSeedData() {
  if (!fs.existsSync(SEED_DATA_PATH)) {
    console.error(`\n❌ Не найден снимок данных: ${SEED_DATA_PATH}`)
    console.error(
      "\nОн должен лежать в репозитории. Если файл потерялся — пересоберите его\n" +
        "на машине, где рядом есть исходники сайта:\n  npm run seed:export"
    )
    process.exit(1)
  }

  let data
  try {
    data = JSON.parse(fs.readFileSync(SEED_DATA_PATH, "utf-8"))
  } catch (error) {
    console.error(`\n❌ Снимок ${SEED_DATA_PATH} повреждён: ${error.message}`)
    console.error("\nПересоберите его: npm run seed:export")
    process.exit(1)
  }

  const required = ["products", "articles", "solutions", "solutionProducts", "contacts", "stats", "process", "faq"]
  const missing = required.filter((key) => !data[key])
  if (missing.length > 0) {
    console.error(`\n❌ В снимке нет обязательных разделов: ${missing.join(", ")}`)
    console.error("\nПересоберите его: npm run seed:export")
    process.exit(1)
  }

  return data
}

const SEED = loadSeedData()

const PRODUCTS = SEED.products
const BLOG_ARTICLES = SEED.articles
const SOLUTIONS = SEED.solutions
const SOLUTION_PRODUCTS = SEED.solutionProducts
const CONTACTS = SEED.contacts
const STATS = SEED.stats
const PROCESS = SEED.process
const FAQ = SEED.faq

const SITE_SETTINGS_ID = "site-settings"

const ADMIN = {
  login: "admin",
  email: "companymayak@mail.ru",
  name: "Администратор",
  role: "SUPERADMIN",
}

/**
 * Администратор создаётся ТОЛЬКО если его ещё нет.
 * Перезапись пароля на каждом прогоне откатывала бы смену пароля из панели,
 * а печать пароля в консоль оставляла бы его в логах CI и в истории терминала.
 */
async function seedAdmin() {
  const existing = await prisma.user.findUnique({ where: { login: ADMIN.login } })

  if (existing) {
    console.log(`👤 Администратор уже существует (login=${existing.login}) — пропускаю`)
    return existing
  }

  const fromEnv = process.env.SEED_ADMIN_PASSWORD?.trim()
  const password =
    fromEnv ||
    `${crypto.randomBytes(12).toString("base64").replace(/[+/=]/g, "")}-${crypto.randomInt(1000, 9999)}`

  const admin = await prisma.user.create({
    data: {
      login: ADMIN.login,
      email: ADMIN.email,
      name: ADMIN.name,
      role: ADMIN.role,
      password: await hash(password),
    },
  })

  console.log(`👤 Администратор создан: login=${admin.login} email=${admin.email} role=${admin.role}`)
  if (fromEnv) {
    console.log("🔑 Пароль взят из SEED_ADMIN_PASSWORD (см. .env)")
  } else {
    // Единственный случай, когда пароль печатается: он сгенерирован здесь и
    // больше нигде не сохранён. Смените его после первого входа.
    console.log(`🔑 SEED_ADMIN_PASSWORD не задан, сгенерирован пароль: ${password}`)
    console.log("   Смените его после первого входа — больше он нигде не сохранён.")
  }

  return admin
}

/**
 * Галерея товара из снимка. Снимок переживает три поколения формата, и сид
 * обязан переварить любое, потому что пересобирает его фронтовый процесс:
 *   1. поля images нет вовсе      -> галерея из одной обложки;
 *   2. images — массив строк      -> строка становится { src, alt: название };
 *   3. images — массив { src, alt } -> берём как есть.
 * Дубликаты по src схлопываются, побеждает первое вхождение.
 */
function buildGallery(product) {
  const source = Array.isArray(product.images) && product.images.length > 0
    ? product.images
    : [product.image]

  const seen = new Set()
  const gallery = []

  for (const item of source) {
    const src = typeof item === "string" ? item.trim() : String(item?.src ?? "").trim()
    if (!src || seen.has(src)) continue

    const rawAlt = typeof item === "string" ? "" : String(item?.alt ?? "").trim()
    seen.add(src)
    // Пустой alt на проде выглядит плохо — подставляем название товара.
    gallery.push({ src, alt: rawAlt || product.name })
  }

  return gallery
}

async function seedProducts() {
  for (const [index, product] of PRODUCTS.entries()) {
    // slug берём из поля id исходных данных — он уже человекочитаемый.
    const data = {
      slug: product.id,
      name: product.name,
      image: product.image,
      images: buildGallery(product),
      purpose: product.purpose,
      type: product.type,
      tags: [...product.tags],
      exploitation: product.exploitation,
      options: [...product.options],
      size: product.size,
      individual: product.individual,
      description: product.description,
      complectation: [...product.complectation],
      sortOrder: index,
      published: true,
    }

    await prisma.product.upsert({
      where: { slug: product.id },
      update: data,
      create: data,
    })
  }

  console.log(`📦 Товары: ${PRODUCTS.length}`)
}

async function seedArticles() {
  for (const [index, article] of BLOG_ARTICLES.entries()) {
    const data = {
      slug: article.slug,
      title: article.title,
      description: article.description,
      excerpt: article.excerpt,
      image: article.image,
      imageAlt: article.imageAlt,
      publishedAt: new Date(article.publishedAt),
      updatedAt: new Date(article.updatedAt),
      readingTime: article.readingTime,
      keywords: [...article.keywords],
      intro: [...article.intro],
      sections: article.sections,
      sortOrder: index,
      published: true,
    }

    await prisma.article.upsert({
      where: { slug: article.slug },
      update: data,
      create: data,
    })
  }

  console.log(`📰 Статьи: ${BLOG_ARTICLES.length}`)
}

async function seedSolutions() {
  let productCount = 0

  for (const [index, solution] of SOLUTIONS.entries()) {
    // key — это поле id исходных данных SOLUTIONS.
    const data = {
      key: solution.id,
      icon: solution.icon,
      label: solution.label,
      kicker: solution.kicker,
      title: solution.title,
      description: solution.description,
      bullets: [...solution.bullets],
      sortOrder: index,
      published: true,
    }

    const saved = await prisma.solution.upsert({
      where: { key: solution.id },
      update: data,
      create: data,
    })

    // Товары-примеры upsert'им по паре (направление + имя): id существующих
    // позиций сохраняются, поэтому ссылки на них не протухают после сида.
    const examples = SOLUTION_PRODUCTS[solution.id] || []

    for (const [itemIndex, item] of examples.entries()) {
      const itemData = {
        solutionId: saved.id,
        name: item.name,
        image: item.image,
        sortOrder: itemIndex,
      }

      await prisma.solutionProduct.upsert({
        where: { solutionId_name: { solutionId: saved.id, name: item.name } },
        update: { image: item.image, sortOrder: itemIndex },
        create: itemData,
      })
    }

    // Удаляем только те позиции, которых больше нет в исходных данных.
    await prisma.solutionProduct.deleteMany({
      where: {
        solutionId: saved.id,
        name: { notIn: examples.map((item) => item.name) },
      },
    })

    productCount += examples.length
  }

  console.log(`🧭 Направления: ${SOLUTIONS.length} (товаров-примеров: ${productCount})`)
}

/**
 * Счётчики аналитики и параметры доставки заявок.
 *
 * Их задаёт владелец в админке, а не исходники сайта, поэтому берём из снимка
 * только то, что там реально есть. Если снимок этих полей не содержит (а
 * сейчас он их и не содержит), они НЕ попадают в update — иначе повторный
 * прогон сида затирал бы настроенные счётчики в null.
 * Значений по умолчанию не выдумываем: пусто так пусто.
 */
function optionalSettingsFromSnapshot() {
  const fields = ["yandexMetrikaId", "googleAnalyticsId", "leadTelegramChatId", "leadEmail"]
  const result = {}

  for (const field of fields) {
    const value = typeof CONTACTS[field] === "string" ? CONTACTS[field].trim() : ""
    if (value) result[field] = value
  }

  // Список получателей уведомлений — тоже настройка владельца, а не контент
  // сайта. Берём из снимка, только если он там реально есть; иначе не трогаем,
  // чтобы повторный сид не обнулил настроенных получателей.
  if (Array.isArray(CONTACTS.leadTelegramChats) && CONTACTS.leadTelegramChats.length > 0) {
    const seen = new Set()
    const chats = []

    for (const item of CONTACTS.leadTelegramChats) {
      const chatId = typeof item === "string" ? item.trim() : String(item?.chatId ?? "").trim()
      if (!chatId || seen.has(chatId)) continue
      seen.add(chatId)
      chats.push({
        chatId,
        label: typeof item === "string" ? "" : String(item?.label ?? "").trim(),
      })
    }

    if (chats.length > 0) result.leadTelegramChats = chats
  }

  // Настройки robots.txt тоже принадлежат владельцу, а не исходникам сайта:
  // подставляем только то, что снимок реально содержит.
  if (typeof CONTACTS.robotsIndexing === "boolean") {
    result.robotsIndexing = CONTACTS.robotsIndexing
  }
  if (Array.isArray(CONTACTS.robotsDisallow) && CONTACTS.robotsDisallow.length > 0) {
    result.robotsDisallow = [
      ...new Set(
        CONTACTS.robotsDisallow
          .map((path) => String(path ?? "").trim())
          .filter((path) => path.startsWith("/"))
      ),
    ]
  }

  return result
}

async function seedSettings() {
  const data = {
    phones: [...CONTACTS.phones],
    telegram: CONTACTS.telegram,
    max: CONTACTS.max,
    email: CONTACTS.email,
    address: CONTACTS.address,
    ...optionalSettingsFromSnapshot(),
  }

  await prisma.siteSetting.upsert({
    where: { id: SITE_SETTINGS_ID },
    update: data,
    create: { id: SITE_SETTINGS_ID, ...data },
  })

  // У Stat/ProcessStep нет естественного уникального ключа, поэтому задаём
  // детерминированные id — тогда upsert не плодит дубли при повторном запуске.
  for (const [index, stat] of STATS.entries()) {
    const statData = {
      value: stat.value,
      label: stat.label,
      icon: stat.icon,
      sortOrder: index,
    }
    await prisma.stat.upsert({
      where: { id: `stat-${index + 1}` },
      update: statData,
      create: { id: `stat-${index + 1}`, ...statData },
    })
  }

  for (const [index, step] of PROCESS.entries()) {
    const stepData = {
      n: step.n,
      title: step.title,
      sortOrder: index,
    }
    await prisma.processStep.upsert({
      where: { id: `process-${index + 1}` },
      update: stepData,
      create: { id: `process-${index + 1}`, ...stepData },
    })
  }

  console.log(
    `⚙️  Настройки: телефонов ${CONTACTS.phones.length}, статистика ${STATS.length}, этапы ${PROCESS.length}`
  )
}

/**
 * Частые вопросы.
 *
 * Наполняем ТОЛЬКО пустую таблицу. FAQ целиком живёт в панели: владелец правит
 * формулировки, снимает вопросы с публикации, удаляет ненужные и добавляет
 * свои. Любое посписочное досоздание воскрешало бы удалённые им вопросы, а
 * upsert затирал бы правки — поэтому, если в таблице уже что-то есть, сид
 * не трогает её вовсе.
 *
 * Тот же принцип, что и с настройками сайта: эталон из снимка нужен для
 * первой установки, дальше источник истины — панель.
 */
async function seedFaq() {
  const existing = await prisma.faqItem.count()

  if (existing > 0) {
    console.log(`❓ Вопросы: в базе уже ${existing} — таблица не тронута`)
    return
  }

  await prisma.faqItem.createMany({
    data: FAQ.map((item, index) => ({
      id: `faq-${index + 1}`,
      question: String(item.question ?? "").trim(),
      answer: String(item.answer ?? "").trim(),
      sortOrder: index,
      published: true,
    })),
  })

  console.log(`❓ Вопросы: создано ${FAQ.length}`)
}

async function main() {
  console.log("🌱 Seeding database...")
  console.log(`📄 Снимок данных от ${SEED.generatedAt || "неизвестной даты"} (${SEED.source || "?"})`)

  await seedAdmin()
  await seedProducts()
  await seedArticles()
  await seedSolutions()
  await seedSettings()
  await seedFaq()

  console.log("✨ Seeding completed!")
}

main()
  .catch((e) => {
    console.error("❌ Error seeding database:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
