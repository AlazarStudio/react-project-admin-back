-- AlterTable
ALTER TABLE "media" ALTER COLUMN "size" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "singleton" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "articles_published_sort_order_published_at_idx" ON "articles"("published", "sort_order", "published_at");

-- CreateIndex
CREATE INDEX "products_published_sort_order_idx" ON "products"("published", "sort_order");

-- CreateIndex
CREATE INDEX "products_type_idx" ON "products"("type");

-- CreateIndex
CREATE INDEX "products_exploitation_idx" ON "products"("exploitation");

-- CreateIndex
CREATE INDEX "products_tags_idx" ON "products" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "products_options_idx" ON "products" USING GIN ("options");

-- CreateIndex
CREATE UNIQUE INDEX "site_settings_singleton_key" ON "site_settings"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "solution_products_solution_id_name_key" ON "solution_products"("solution_id", "name");

-- CreateIndex
CREATE INDEX "solutions_published_sort_order_idx" ON "solutions"("published", "sort_order");

