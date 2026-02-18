import { prisma } from "../app/prisma.js"

async function main() {
  const now = new Date()

  const result = await prisma.$runCommandRaw({
    update: "menus",
    updates: [
      {
        q: { $or: [{ label: null }, { label: { $exists: false } }] },
        u: { $set: { label: "Без названия" } },
        multi: true
      },
      {
        q: { $or: [{ url: null }, { url: { $exists: false } }] },
        u: { $set: { url: "/" } },
        multi: true
      },
      {
        q: { createdAt: { $exists: false } },
        u: { $set: { createdAt: now } },
        multi: true
      },
      {
        q: { updatedAt: { $exists: false } },
        u: { $set: { updatedAt: now } },
        multi: true
      }
    ]
  })

  console.log("Repair command result:", JSON.stringify(result, null, 2))
}

main()
  .catch((error) => {
    console.error("Failed to repair menu documents:", error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
