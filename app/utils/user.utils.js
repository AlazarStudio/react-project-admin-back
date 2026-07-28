export const UserFields = {
  id: true,
  createdAt: true,
  updatedAt: true,
  email: true,
  login: true,
  name: true,
  role: true,
  // Раньше это был встроенный тип MongoDB, теперь — связь 1:1.
  // Выбираем только контентные поля, чтобы форма ответа не изменилась.
  userInformation: {
    select: {
      firstName: true,
      lastName: true
    }
  }
}
