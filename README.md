# REST Backend Template

Шаблон для создания REST API на Node.js с Express, Prisma и PostgreSQL.

## Установка

1. Клонируйте репозиторий или используйте как шаблон.

2. Установите зависимости:

```bash
npm i
npm i prisma@6.19 -g
```

### Важно!!! Не используйте `npm update --save` до обновления схемы и адаптера prisma до новой версии, вы можете "сломать" проект.

### Если вы всё же обновили используйте эту команду `npm i prisma@6.19 @prisma/client@6.19`

3. Создайте файл `.env` в корне проекта:

```env
NODE_ENV=development
PORT=5000
DATABASE_URL="postgresql://user:password@localhost:5432/dbname?schema=public"
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

4. Настройте базу данных:

```bash
# Создайте миграцию:
npx prisma migrate dev --name init
# Если prisma установлена глобально:
prisma migrate dev --name init

# Или примените существующую схему:
npx prisma generate
npx prisma db push
# Если prisma установлена глобально:
prisma generate
prisma db push
```

### Важно!!! Если в базе данных уже есть записи и вы обновляете схему убедитесь, что push схемы не сотрёт данные или используйте миграцию.

5. Запустите сервер:

```bash
npm run dev
```

## API Endpoints

### Аутентификация

- `POST /api/auth/register` - Регистрация пользователя.

  ```json
  {
    "login": "username",
    "email": "user@example.com",
    "password": "password",
    "name": "User Name"
  }
  ```

- `POST /api/auth/login` - Вход.
  ```json
  {
    "login": "username",
    "password": "password"
  }
  ```

### Пользователи (требует аутентификации)

- `GET /api/users/profile` - Получить профиль текущего пользователя.
- `PUT /api/users/profile` - Обновить профиль.
  ```json
  {
    "name": "New Name",
    "email": "newemail@example.com",
    "password": "newpassword",
    "userInformation": {
      "firstName": "First",
      "lastName": "Last"
    }
  }
  ```

## Аутентификация

Для защищенных маршрутов добавьте заголовок:

```
Authorization: Bearer <your-jwt-token>
```

## Создание нового ресурса

Используйте папку `_empty` как шаблон для создания новых ресурсов:

1. Скопируйте `app/_empty` в `app/your-resource`
2. Замените `_empty` на название вашего ресурса
3. Добавьте модель в `prisma/schema.prisma`
4. Подключите роуты в `server.js`

## Скрипты

- `npm run dev` - Запуск в режиме разработки с nodemon.
- `npm run prisma` - Запуск Prisma CLI.
- `prisma studio` - Запуск Prisma Studio. Для входа: localhost:5555 (На удалённом с сервере замените localhost на ip вашего сервера).
