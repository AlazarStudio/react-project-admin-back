-- Product.images: text[] (пути) -> jsonb (массив { src, alt }).
--
-- Prisma для смены типа предлагает DROP + ADD COLUMN, что стёрло бы галереи.
-- Поэтому конвертируем вручную через временную колонку, сохраняя порядок
-- фотографий (WITH ORDINALITY) и подставляя осмысленный alt.

-- 1. Временная колонка нового типа.
ALTER TABLE "products" ADD COLUMN "images_json" JSONB NOT NULL DEFAULT '[]';

-- 2. Перенос данных: каждый путь -> { src: путь, alt: название товара }.
--    Пустой alt в проде смотрелся бы плохо, а название товара — осмысленный
--    и точный текст для screen reader'а по умолчанию.
UPDATE "products" p
SET "images_json" = COALESCE(
  (
    SELECT jsonb_agg(
             jsonb_build_object('src', t.elem, 'alt', p."name")
             ORDER BY t.ord
           )
    FROM unnest(p."images") WITH ORDINALITY AS t(elem, ord)
    WHERE t.elem IS NOT NULL AND t.elem <> ''
  ),
  '[]'::jsonb
);

-- 3. Подстраховка: товар с обложкой не должен остаться с пустой галереей.
UPDATE "products"
SET "images_json" = jsonb_build_array(jsonb_build_object('src', "image", 'alt', "name"))
WHERE jsonb_array_length("images_json") = 0
  AND "image" <> '';

-- 4. Замена колонки.
ALTER TABLE "products" DROP COLUMN "images";
ALTER TABLE "products" RENAME COLUMN "images_json" TO "images";
