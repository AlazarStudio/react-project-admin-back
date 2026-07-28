-- Список получателей уведомлений о заявке вместо одиночного chat_id.
-- Аддитивно: старая колонка lead_telegram_chat_id НЕ удаляется, она остаётся
-- запасным вариантом на время рассинхрона выкатки фронта и бэкенда.

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "lead_telegram_chats" JSONB NOT NULL DEFAULT '[]';

-- Перенос текущего одиночного получателя в новый список, чтобы уведомления
-- не пропали в момент выкатки. Подпись поясняет происхождение записи.
UPDATE "site_settings"
SET "lead_telegram_chats" = jsonb_build_array(
      jsonb_build_object(
        'chatId', trim("lead_telegram_chat_id"),
        'label',  'Перенесено из прежней настройки'
      )
    )
WHERE "lead_telegram_chat_id" IS NOT NULL
  AND trim("lead_telegram_chat_id") <> ''
  AND jsonb_array_length("lead_telegram_chats") = 0;
