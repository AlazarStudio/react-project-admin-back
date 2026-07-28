-- Частые вопросы (FAQ), редактируемые из панели. Новая таблица, существующих
-- данных не касается.

-- CreateTable
CREATE TABLE "faq_items" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faq_items_sort_order_idx" ON "faq_items"("sort_order");

-- CreateIndex
CREATE INDEX "faq_items_published_sort_order_idx" ON "faq_items"("published", "sort_order");

