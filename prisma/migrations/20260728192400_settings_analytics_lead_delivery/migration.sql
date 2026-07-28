-- Счётчики аналитики и параметры доставки заявок в настройках сайта.
-- Все колонки необязательные: существующая единственная строка настроек
-- получает NULL и не страдает, ограничение singleton не затрагивается.
--
-- Токена Telegram-бота здесь намеренно нет: он остаётся в .env сайта,
-- потому что база уезжает в резервные копии.

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "google_analytics_id" TEXT,
ADD COLUMN     "lead_email" TEXT,
ADD COLUMN     "lead_telegram_chat_id" TEXT,
ADD COLUMN     "yandex_metrika_id" TEXT;
