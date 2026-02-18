import { prisma } from '../app/prisma.js'
import { hash } from 'argon2'

async function main() {
  console.log('🌱 Seeding database...')

  // Проверяем, существует ли пользователь admin
  const existingAdmin = await prisma.user.findUnique({
    where: {
      login: 'admin'
    }
  })

  if (existingAdmin) {
    console.log('✅ Admin user already exists')
  } else {
    // Создаем пользователя admin
    const hashedPassword = await hash('admin')
    
    const admin = await prisma.user.create({
      data: {
        login: 'admin',
        email: 'admin@example.com',
        password: hashedPassword,
        name: 'Администратор',
        role: 'SUPERADMIN'
      }
    })

    console.log('✅ Admin user created:', {
      id: admin.id,
      login: admin.login,
      email: admin.email,
      role: admin.role
    })
  }

  console.log('✨ Seeding completed!')
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
