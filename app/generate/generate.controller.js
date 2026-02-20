import asyncHandler from "express-async-handler"
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { prisma } from "../prisma.js"
import {
  generatePrismaModel,
  generateStructureModel,
  generateController,
  generateStructureController,
  generateRoutes,
  generateStructureRoutes,
  addModelToSchema,
  createControllerFile,
  createRoutesFile,
  registerRoutesInServer,
  syncPrisma,
  validateResourceName
} from "../utils/code-generator.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const execFileAsync = promisify(execFile)
const rootDir = path.resolve(__dirname, "../../")
const appDir = path.join(rootDir, "app")

const CORE_APP_DIRS = new Set([
  "auth",
  "config",
  "generate",
  "media",
  "middleware",
  "user",
  "utils",
  "_empty",
])
const SYSTEM_COLLECTIONS = new Set(["User", "configs"])

async function listGeneratedAppDirs() {
  const entries = await fs.readdir(appDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !CORE_APP_DIRS.has(name))
}

async function readFilesRecursively(baseDir, relDir = "") {
  const currentDir = relDir ? path.join(baseDir, relDir) : baseDir
  const entries = await fs.readdir(currentDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relPath = relDir ? path.join(relDir, entry.name) : entry.name
    if (entry.isDirectory()) {
      const nested = await readFilesRecursively(baseDir, relPath)
      files.push(...nested)
      continue
    }
    const absPath = path.join(baseDir, relPath)
    const content = await fs.readFile(absPath, "utf-8")
    files.push({ path: relPath.replace(/\\/g, "/"), content })
  }

  return files
}

async function writeSnapshotDir(baseDir, files) {
  for (const file of files) {
    const relPath = String(file.path || "").replace(/\\/g, "/")
    if (!relPath || relPath.startsWith("/") || relPath.includes("..")) {
      throw new Error(`Invalid snapshot file path: ${relPath}`)
    }
    const target = path.join(baseDir, relPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file.content, "utf-8")
  }
}

async function listCollections() {
  const result = await prisma.$runCommandRaw({ listCollections: 1 })
  return (result?.cursor?.firstBatch || [])
    .map((collection) => collection?.name)
    .filter(Boolean)
    .filter((name) => !name.startsWith("system."))
}

function hasPrismaModel(schemaContent, modelName) {
  return new RegExp(`model\\s+${modelName}\\s*\\{`).test(String(schemaContent || ""))
}

function validateImportSnapshotOrThrow(payload) {
  const files = payload?.files
  const database = payload?.database
  if (!files?.prismaSchema || !files?.serverJs || !Array.isArray(files?.generatedAppDirs)) {
    throw new Error("Invalid snapshot.files format")
  }
  if (!Array.isArray(database?.collections)) {
    throw new Error("Invalid snapshot.database.collections format")
  }
  if (!hasPrismaModel(files.prismaSchema, "User") || !hasPrismaModel(files.prismaSchema, "Config")) {
    throw new Error("Snapshot schema must contain User and Config models")
  }
  const collectionNames = new Set(database.collections.map((c) => c?.name).filter(Boolean))
  for (const name of SYSTEM_COLLECTIONS) {
    if (!collectionNames.has(name)) {
      throw new Error(`Snapshot does not contain required system collection: ${name}`)
    }
  }
}

async function getCollectionDocuments(name) {
  const result = await prisma.$runCommandRaw({
    find: name,
    filter: {},
  })
  return result?.cursor?.firstBatch || []
}

async function dropCollectionIfExists(name) {
  try {
    await prisma.$runCommandRaw({ drop: name })
  } catch (error) {
    const message = String(error?.message || "").toLowerCase()
    if (!message.includes("ns not found")) {
      throw error
    }
  }
}

async function restoreCollection(name, documents) {
  await dropCollectionIfExists(name)
  if (!Array.isArray(documents) || documents.length === 0) return
  await prisma.$runCommandRaw({
    insert: name,
    documents,
  })
}

function normalizeSlug(raw = "") {
  return String(raw)
    .trim()
    .replace(/^\/+/, "")
    .replace(/^admin\/?/i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
}

function resourceNameToSlug(resourceName = "") {
  return String(resourceName)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
}

const DYNAMIC_PAGES_COLLECTION = "dynamic_pages"

function normalizeDynamicPageDoc(doc) {
  if (!doc || typeof doc !== "object") return null
  const page = { ...doc }
  if (page._id && typeof page._id === "object" && page._id.$oid) {
    page.id = page._id.$oid
    delete page._id
  }
  return page
}

async function findDynamicPageBySlug(slug) {
  const result = await prisma.$runCommandRaw({
    find: DYNAMIC_PAGES_COLLECTION,
    filter: { slug: String(slug) },
    limit: 1,
  })
  const doc = result?.cursor?.firstBatch?.[0]
  return normalizeDynamicPageDoc(doc)
}

async function upsertDynamicPage({ slug, title, blocks = [], structure = {} }) {
  const now = new Date()
  await prisma.$runCommandRaw({
    update: DYNAMIC_PAGES_COLLECTION,
    updates: [
      {
        q: { slug: String(slug) },
        u: {
          $set: {
            slug: String(slug),
            title: title || String(slug),
            blocks: blocks || [],
            structure: structure || {},
            updated_at: now,
          },
          $setOnInsert: { created_at: now },
        },
        upsert: true,
        multi: false,
      },
    ],
  })

  return findDynamicPageBySlug(slug)
}

// @desc    Generate resource (model, controller, routes)
// @route   POST /api/admin/generate-resource
// @access  Private (Admin only)
export const generateResource = asyncHandler(async (req, res) => {
  const { resourceName, fields, menuItem, resourceType, structure } = req.body

  // Валидация входных данных
  if (!resourceName || !fields || !Array.isArray(fields)) {
    res.status(400)
    throw new Error("resourceName and fields array are required")
  }

  // Валидация имени ресурса
  try {
    validateResourceName(resourceName)
  } catch (error) {
    res.status(400)
    throw error
  }

  // Валидация полей
  if (fields.length === 0) {
    res.status(400)
    throw new Error("At least one field is required")
  }

  for (const field of fields) {
    if (!field.name || !field.type) {
      res.status(400)
      throw new Error("Each field must have 'name' and 'type' properties")
    }
    
    // Валидация имени поля
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.name)) {
      res.status(400)
      throw new Error(`Invalid field name: ${field.name}`)
    }
    
    // Валидация типа поля
    const validTypes = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json']
    if (!validTypes.includes(field.type)) {
      res.status(400)
      throw new Error(`Invalid field type: ${field.type}. Valid types: ${validTypes.join(', ')}`)
    }
  }

  console.log(`🚀 Генерация ресурса: ${resourceName}`)
  console.log(`📋 Поля:`, JSON.stringify(fields, null, 2))
  console.log(`📋 Menu Item:`, menuItem ? JSON.stringify(menuItem, null, 2) : 'не указан')
  console.log(`📋 Structure:`, structure ? JSON.stringify(structure, null, 2) : 'не передана')
  console.log(`📋 Structure fields count:`, structure?.fields?.length || 0)

  try {
    // 1. Генерируем модель Prisma
    console.log('📝 [1/6] Генерирую модель Prisma...')
    const prismaModel = generatePrismaModel(resourceName, fields)
    console.log('📝 Сгенерированная модель:', prismaModel)
    await addModelToSchema(prismaModel)
    console.log('✅ [1/6] Модель Prisma добавлена в схему')

    // 1.5. Генерируем модель структуры
    console.log('📝 [1.5/6] Генерирую модель структуры...')
    const structureModel = generateStructureModel(resourceName)
    await addModelToSchema(structureModel)
    console.log('✅ [1.5/6] Модель структуры добавлена в схему')

    // 2. Генерируем контроллер
    console.log('📝 [2/6] Генерирую контроллер...')
    const controllerContent = generateController(resourceName, fields, resourceType)
    await createControllerFile(resourceName, controllerContent)
    console.log('✅ [2/6] Контроллер создан')

    // 2.5. Генерируем контроллер структуры
    console.log('📝 [2.5/6] Генерирую контроллер структуры...')
    const structureControllerContent = generateStructureController(resourceName)
    const structureControllerPath = `${resourceName.toLowerCase()}Structure.controller.js`
    const structureControllerDir = path.join(__dirname, `../${resourceName.toLowerCase()}`)
    await fs.mkdir(structureControllerDir, { recursive: true })
    await fs.writeFile(path.join(structureControllerDir, structureControllerPath), structureControllerContent, 'utf-8')
    console.log('✅ [2.5/6] Контроллер структуры создан')

    // 3. Генерируем роуты
    console.log('📝 [3/6] Генерирую роуты...')
    const routesContent = generateRoutes(resourceName, fields, resourceType)
    await createRoutesFile(resourceName, routesContent)
    console.log('✅ [3/6] Роуты созданы')

    // 3.5. Генерируем роуты структуры
    console.log('📝 [3.5/6] Генерирую роуты структуры...')
    const structureRoutesContent = generateStructureRoutes(resourceName)
    const structureRoutesPath = `${resourceName.toLowerCase()}Structure.routes.js`
    const structureRoutesDir = path.join(__dirname, `../${resourceName.toLowerCase()}`)
    await fs.mkdir(structureRoutesDir, { recursive: true })
    await fs.writeFile(path.join(structureRoutesDir, structureRoutesPath), structureRoutesContent, 'utf-8')
    console.log('✅ [3.5/6] Роуты структуры созданы')

    // 4. Регистрируем роуты в server.js
    console.log('📝 [4/6] Регистрирую роуты в server.js...')
    await registerRoutesInServer(resourceName)
    // Регистрируем роуты структуры
    const structureRouteName = resourceName.toLowerCase() + 'Structure' // camelCase URL путь без дефисов
    const structureImportName = `${resourceName.charAt(0).toLowerCase() + resourceName.slice(1)}StructureRoutes` // camelCase для переменной
    const structureImportPath = `./app/${resourceName.toLowerCase()}/${resourceName.toLowerCase()}Structure.routes.js`
    const serverPath = path.join(__dirname, '../../server.js')
    let serverContent = await fs.readFile(serverPath, 'utf-8')
    
    // Проверяем импорт
    if (!serverContent.includes(structureImportName)) {
      // Добавляем импорт после других импортов
      const importRegex = /import\s+\w+Routes\s+from\s+["'].*routes\.js["']/g
      const imports = serverContent.match(importRegex) || []
      const lastImport = imports[imports.length - 1]
      if (lastImport) {
        const lastImportIndex = serverContent.lastIndexOf(lastImport)
        const insertIndex = serverContent.indexOf('\n', lastImportIndex) + 1
        serverContent = serverContent.slice(0, insertIndex) + 
          `import ${structureImportName} from "${structureImportPath}"\n` + 
          serverContent.slice(insertIndex)
      }
    }
    
    // Проверяем регистрацию роутов
    if (!serverContent.includes(`app.use("/api/${structureRouteName}"`)) {
      const routeRegistration = `  app.use("/api/${structureRouteName}", ${structureImportName})\n`
      const appUseRegex = /app\.use\(["']\/api\/\w+["'],\s+\w+Routes\)/g
      const appUses = serverContent.match(appUseRegex) || []
      const lastAppUse = appUses[appUses.length - 1]
      if (lastAppUse) {
        const lastAppUseIndex = serverContent.lastIndexOf(lastAppUse)
        const insertIndex = serverContent.indexOf('\n', lastAppUseIndex) + 1
        serverContent = serverContent.slice(0, insertIndex) + routeRegistration + serverContent.slice(insertIndex)
      }
    }
    
    await fs.writeFile(serverPath, serverContent, 'utf-8')
    console.log('✅ [4/6] Роуты зарегистрированы в server.js')

    // 4.5. Создаем/обновляем DynamicPage для динамического slug
    // Это убирает 404 при первом переходе на /admin/dynamic/:slug после генерации ресурса.
    const menuSlug = normalizeSlug(menuItem?.url || "")
    const fallbackSlug = resourceNameToSlug(resourceName)
    const dynamicSlug = menuSlug || fallbackSlug
    const dynamicTitle = menuItem?.label || resourceName
    const dynamicStructure = {
      fields: Array.isArray(structure?.fields) ? structure.fields : [],
    }

    if (dynamicSlug) {
      await upsertDynamicPage({
        slug: dynamicSlug,
        title: dynamicTitle,
        blocks: [],
        structure: dynamicStructure,
      })
      console.log(`✅ [4.5/6] DynamicPage upsert выполнен для slug: ${dynamicSlug}`)
    } else {
      console.log('⚠️ [4.5/6] DynamicPage не создан: пустой slug')
    }

    // Отправляем ответ клиенту ДО выполнения Prisma команд,
    // чтобы nodemon не обрывал соединение при перезапуске
    const routeName = resourceName.toLowerCase()
    // Определяем, является ли ресурс singleton
    const jsonFields = fields.filter(f => f.type === 'Json')
    const isSingleton = resourceType === 'singleton' || (jsonFields.length === 1 && fields.length === 1)
    const isBulkCollection = resourceType === 'collectionBulk'
    
    const endpoints = isBulkCollection
      ? {
          getAll: `GET /api/${routeName}`,
          getById: `GET /api/${routeName}/:id`,
          create: `POST /api/${routeName}`,
          update: `PUT /api/${routeName}`,
          delete: `DELETE /api/${routeName}/:id`
        }
      : isSingleton
      ? {
          getAll: `GET /api/${routeName}`,
          getById: `GET /api/${routeName}/:id`,
          create: `POST /api/${routeName}`,
          update: `PUT /api/${routeName}`, // Для singleton ресурсов PUT без :id
          delete: `DELETE /api/${routeName}/:id`
        }
      : {
          getAll: `GET /api/${routeName}`,
          getById: `GET /api/${routeName}/:id`,
          create: `POST /api/${routeName}`,
          update: `PUT /api/${routeName}/:id`,
          delete: `DELETE /api/${routeName}/:id`
        }
    
    const responseData = {
      success: true,
      message: `Resource ${resourceName} generated successfully`,
      resourceName,
      endpoints
    }
    
    // Отправляем ответ клиенту
    res.json(responseData)
    console.log(`✅ Ресурс ${resourceName} успешно создан! Ответ отправлен клиенту.`)


    // 6. Синхронизируем Prisma (только db push, без generate) в фоне
    // Выполняем после отправки ответа, чтобы nodemon мог перезапуститься без обрыва соединения
    // prisma generate не выполняем, так как файл заблокирован запущенным сервером
    // Prisma Client обновится автоматически при перезапуске сервера nodemon'ом
    console.log('📝 [6/6] Синхронизирую схему с БД (в фоне)...')
    syncPrisma()
      .then(async () => {
        console.log('✅ [6/6] Схема синхронизирована с БД')
        console.log('ℹ️ Prisma Client будет обновлен при перезапуске сервера nodemon\'ом')
        
        // 5. Сохраняем структуру в БД через новый API структуры (если передана)
        // Пытаемся сохранить после синхронизации Prisma, но модель может быть еще не доступна
        // Структура будет сохранена через API структуры после перезапуска сервера
        if (structure && structure.fields && Array.isArray(structure.fields)) {
          console.log(`📝 [5/6] Структура будет сохранена через API структуры после перезапуска сервера`)
          console.log(`📝 Поля структуры: ${structure.fields.length} блоков`)
        }
      })
      .catch((prismaError) => {
        console.error('❌ Ошибка синхронизации Prisma (не критично, ресурс уже создан):', prismaError.message)
        console.log('ℹ️ Схема будет синхронизирована при следующем перезапуске сервера')
        // Не выбрасываем ошибку, так как ответ уже отправлен
      })
  } catch (error) {
    console.error(`❌ Ошибка генерации ресурса ${resourceName}:`, error)
    console.error('Stack trace:', error.stack)
    
    // Выводим детальную информацию об ошибке
    if (error.stderr) {
      console.error('Error stderr:', error.stderr.toString())
    }
    if (error.stdout) {
      console.error('Error stdout:', error.stdout.toString())
    }
    
    // Пытаемся откатить изменения, если возможно
    // (в реальном проекте здесь можно добавить логику отката)
    
    // Формируем сообщение об ошибке
    let errorMessage = `Failed to generate resource: ${error.message}`
    
    if (error.stderr) {
      const stderrStr = error.stderr.toString()
      if (stderrStr.trim()) {
        errorMessage += `\nPrisma error: ${stderrStr}`
      }
    }
    
    if (error.stdout) {
      const stdoutStr = error.stdout.toString()
      if (stdoutStr.trim()) {
        errorMessage += `\nOutput: ${stdoutStr}`
      }
    }
    
    // asyncHandler ожидает, что мы выбросим ошибку
    // errorHandler middleware обработает её и отправит ответ клиенту
    res.status(500)
    throw new Error(errorMessage)
  }
})

// @desc    Get dynamic page by slug
// @route   GET /api/admin/dynamic-pages/:slug
// @access  Private (Admin only)
export const getDynamicPage = asyncHandler(async (req, res) => {
  const { slug } = req.params

  let page = await findDynamicPageBySlug(slug)

  if (!page) {
    // Автосоздание страницы для обратной совместимости:
    // если ресурс уже сгенерирован ранее без DynamicPage, не возвращаем 404.
    page = await upsertDynamicPage({
      slug,
      title: slug,
      blocks: [],
      structure: { fields: [] },
    })
    console.log(`ℹ️ DynamicPage не найден, создан автоматически: ${slug}`)
  }

  res.json(page)
})

// @desc    Create or update dynamic page by slug
// @route   PUT /api/admin/dynamic-pages/:slug
// @access  Private (Admin only)
export const updateDynamicPage = asyncHandler(async (req, res) => {
  const { slug } = req.params
  const { title, blocks, structure } = req.body

  let page = await findDynamicPageBySlug(slug)

  if (!page) {
    page = await upsertDynamicPage({
      slug,
      title: title || slug,
      blocks: blocks || [],
      structure: structure || {},
    })
    return res.status(201).json(page)
  }

  const updatedPage = await upsertDynamicPage({
    slug,
    title: title !== undefined ? title : page.title,
    blocks: blocks !== undefined ? blocks : page.blocks,
    structure: structure !== undefined ? structure : page.structure,
  })

  res.json(updatedPage)
})

// @desc    Create dynamic page
// @route   POST /api/admin/dynamic-pages/:slug
// @access  Private (Admin only)
export const createDynamicPage = asyncHandler(async (req, res) => {
  const { slug } = req.params
  const { title, blocks, structure } = req.body

  // Проверяем, существует ли уже страница с таким slug
  const existing = await findDynamicPageBySlug(slug)

  if (existing) {
    return res.status(400).json({ 
      message: `Dynamic page with slug "${slug}" already exists` 
    })
  }

  const page = await upsertDynamicPage({
    slug,
    title: title || slug,
    blocks: blocks || [],
    structure: structure || {},
  })

  res.status(201).json(page)
})

// @desc    Export full generated snapshot (files + collections)
// @route   GET /api/admin/data/export
// @access  Private (Admin only)
export const exportGeneratedSnapshot = asyncHandler(async (_req, res) => {
  const generatedDirs = await listGeneratedAppDirs()
  const generatedAppDirs = []
  for (const dirName of generatedDirs) {
    const dirPath = path.join(appDir, dirName)
    const files = await readFilesRecursively(dirPath)
    generatedAppDirs.push({ name: dirName, files })
  }

  const schemaPath = path.join(rootDir, "prisma", "schema.prisma")
  const serverPath = path.join(rootDir, "server.js")
  const [schemaContent, serverContent] = await Promise.all([
    fs.readFile(schemaPath, "utf-8"),
    fs.readFile(serverPath, "utf-8"),
  ])

  const collectionNames = await listCollections()
  const collections = []
  for (const name of collectionNames) {
    const documents = await getCollectionDocuments(name)
    collections.push({ name, documents })
  }

  res.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    snapshot: {
      files: {
        prismaSchema: schemaContent,
        serverJs: serverContent,
        generatedAppDirs,
      },
      database: {
        collections,
      },
    },
  })
})

// @desc    Import full generated snapshot with reset
// @route   POST /api/admin/data/import
// @access  Private (Admin only)
export const importGeneratedSnapshot = asyncHandler(async (req, res) => {
  const payload = req.body?.snapshot
  if (!payload || typeof payload !== "object") {
    res.status(400)
    throw new Error("snapshot is required")
  }

  try {
    validateImportSnapshotOrThrow(payload)
  } catch (validationError) {
    res.status(400)
    throw validationError
  }
  const files = payload.files
  const database = payload.database

  const existingCollections = await listCollections()
  const existingCollectionSet = new Set(existingCollections)
  const systemBackup = []
  for (const name of SYSTEM_COLLECTIONS) {
    if (!existingCollectionSet.has(name)) continue
    const docs = await getCollectionDocuments(name)
    systemBackup.push({ name, documents: docs })
  }

  const resetScriptPath = path.join(rootDir, "scripts", "reset-generated.mjs")
  await execFileAsync("node", [resetScriptPath, "--apply"], {
    cwd: rootDir,
    maxBuffer: 20 * 1024 * 1024,
  })

  const currentGeneratedDirs = await listGeneratedAppDirs()
  for (const dirName of currentGeneratedDirs) {
    await fs.rm(path.join(appDir, dirName), { recursive: true, force: true })
  }

  const schemaPath = path.join(rootDir, "prisma", "schema.prisma")
  const serverPath = path.join(rootDir, "server.js")
  await fs.writeFile(schemaPath, files.prismaSchema, "utf-8")
  await fs.writeFile(serverPath, files.serverJs, "utf-8")

  for (const dir of files.generatedAppDirs) {
    if (!dir?.name || !Array.isArray(dir?.files)) continue
    if (!/^[a-z0-9_-]+$/i.test(dir.name)) {
      throw new Error(`Invalid generated dir name: ${dir.name}`)
    }
    const dirPath = path.join(appDir, dir.name)
    await fs.mkdir(dirPath, { recursive: true })
    await writeSnapshotDir(dirPath, dir.files)
  }

  for (const collection of database.collections) {
    if (!collection?.name) continue
    if (SYSTEM_COLLECTIONS.has(collection.name)) continue
    await restoreCollection(collection.name, collection.documents || [])
  }

  for (const collection of systemBackup) {
    await restoreCollection(collection.name, collection.documents || [])
  }

  res.json({
    success: true,
    message: "Импорт завершен. Все данные и сгенерированные ресурсы заменены.",
  })
})
