# Шаблон для создания нового ресурса

Эта папка содержит шаблон для быстрого создания контроллеров и роутов для нового ресурса.

## Как использовать

1. **Скопируйте папку `_empty`** и переименуйте её в название вашего ресурса (например, `product`, `order`, `category`).

2. **Замените `_empty` на название ресурса** во всех файлах:

   - В именах файлов: `_empty.controller.js` → `product.controller.js`
   - В именах функций: `get_Emptys` → `getProducts`
   - В именах переменных: `_empty` → `product`
   - В Prisma запросах: `prisma._empty` → `prisma.product`

3. **Добавьте модель в Prisma schema** (`prisma/schema.prisma`):

   ```prisma
   model Product {
     id        Int      @id @default(autoincrement())
     createdAt DateTime @default(now())
     updatedAt DateTime @updatedAt
     name      String
     price     Float
     // Добавьте свои поля
   }
   ```

4. **Настройте контроллер** (`*_empty.controller.js`):

   - Замените все `TODO` комментарии на реальную логику.
   - Добавьте поля из `req.body` в функции создания и обновления.
   - Настройте проверку прав доступа (если нужно).

5. **Настройте валидацию** (`*_empty.routes.js`):

   - Раскомментируйте `validateRequest` и настройте правила валидации.
   - Добавьте валидацию для всех необходимых полей.

6. **Подключите роуты в `server.js`**:

   ```javascript
   import productRoutes from "./app/product/product.routes.js"

   app.use("/api/products", productRoutes)
   ```

7. **Создайте миграцию Prisma**:
   ```bash
   npx prisma migrate dev --name add_product
   npx prisma generate
   ```

## Доступные endpoints

После настройки будут доступны следующие endpoints:

- `GET /api/_emptys` - Получить список (с пагинацией)
- `GET /api/_emptys/:id` - Получить по ID
- `POST /api/_emptys` - Создать новый
- `PUT /api/_emptys/:id` - Обновить
- `DELETE /api/_emptys/:id` - Удалить

## Особенности шаблона

- Пагинация для списка (query параметры `page` и `limit`)
- Валидация ID
- Проверка существования записи перед обновлением/удалением
- Правильные HTTP статусы (201 для создания, 404 для не найденных)
- Защита всех маршрутов через `protect` middleware
- Готовность к добавлению валидации через `validateRequest`

## Дополнительные возможности

### Добавление проверки прав доступа

Если ресурс принадлежит пользователю, добавьте проверку:

```javascript
if (existing.userId !== req.user.id) {
  res.status(403)
  throw new Error("Not authorized to access this resource")
}
```

### Добавление фильтрации и поиска

В `get_Emptys` можно добавить:

```javascript
const where = {}
if (req.query.search) {
  where.name = { contains: req.query.search, mode: "insensitive" }
}
// Используйте where в findMany
```

### Добавление связи с пользователем

В Prisma schema добавьте:

```prisma
model Product {
  // ...
  userId Int
  user   User @relation(fields: [userId], references: [id])
}
```
