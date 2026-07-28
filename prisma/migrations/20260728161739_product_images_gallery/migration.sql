-- AlterTable
ALTER TABLE "products" ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: у товаров, заведённых до появления галереи, она состоит из обложки.
-- Товара с заполненной обложкой и пустой галереей в базе остаться не должно.
UPDATE "products"
SET "images" = ARRAY["image"]
WHERE ("images" IS NULL OR cardinality("images") = 0)
  AND "image" <> '';
