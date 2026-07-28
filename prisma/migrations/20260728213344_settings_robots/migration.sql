-- Управление robots.txt из панели.
-- Аддитивно: обе колонки с безопасными умолчаниями, существующая единственная
-- строка настроек получает robots_indexing = true (индексация разрешена)
-- и пустой список дополнительных запретов. Ограничение singleton не затрагивается.
--
-- Служебные запреты сайта (/api/, /admin, /konfigurator) здесь не хранятся —
-- они зашиты в коде сайта и не зависят от содержимого базы.

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "robots_disallow" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "robots_indexing" BOOLEAN NOT NULL DEFAULT true;
