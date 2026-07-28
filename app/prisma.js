import { PrismaClient } from "../generated/client_recovery/index.js"

// Media.size хранится как BigInt (int8), а JSON.stringify на BigInt падает
// с TypeError. Размеры файлов заведомо меньше 2^53, поэтому отдаём числом —
// форма ответа API остаётся прежней.
if (typeof BigInt.prototype.toJSON !== "function") {
  BigInt.prototype.toJSON = function toJSON() {
    return Number.isSafeInteger(Number(this)) ? Number(this) : this.toString()
  }
}

export const prisma = new PrismaClient()
