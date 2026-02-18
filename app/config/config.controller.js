import asyncHandler from "express-async-handler"
import axios from "axios"
import { prisma } from "../prisma.js"

// @desc    Get backend configuration
// @route   GET /api/config
// @access  Public
export const getConfig = asyncHandler(async (req, res) => {
  const config = await prisma.config.findFirst({
    orderBy: {
      updatedAt: "desc"
    }
  })

  res.json({
    backendApiUrl: config?.backendApiUrl || null
  })
})

// @desc    Save or update backend configuration
// @route   PUT /api/config
// @access  Public
export const updateConfig = asyncHandler(async (req, res) => {
  const { backendApiUrl, frontendUrl } = req.body

  if (!backendApiUrl || typeof backendApiUrl !== "string") {
    res.status(400)
    throw new Error("backendApiUrl is required and must be a string")
  }

  const existingConfig = await prisma.config.findFirst({
    orderBy: {
      updatedAt: "desc"
    }
  })

  let config
  const data = {
    backendApiUrl: backendApiUrl.trim()
  }
  
  if (frontendUrl && typeof frontendUrl === "string") {
    data.frontendUrl = frontendUrl.trim()
  }
  
  if (existingConfig) {
    config = await prisma.config.update({
      where: {
        id: existingConfig.id
      },
      data
    })
  } else {
    config = await prisma.config.create({
      data
    })
  }

  // Обновляем config.json на фронтенде через PHP скрипт
  const frontendUrlToUse = config.frontendUrl || frontendUrl
  if (frontendUrlToUse && typeof frontendUrlToUse === "string") {
    try {
      const endpoint = `${frontendUrlToUse.trim().replace(/\/+$/, "")}/update-config.php`
      console.log('📤 Отправляю запрос на обновление config.json:', endpoint)
      console.log('📦 Данные:', { backendApiUrl: config.backendApiUrl })
      
      const response = await axios.post(endpoint, { backendApiUrl: config.backendApiUrl }, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        },
        validateStatus: (status) => status < 500
      })
      
      console.log('✅ config.json обновлен на фронтенде:', response.data)
    } catch (error) {
      console.error('❌ Ошибка обновления config.json на фронтенде:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        endpoint: `${frontendUrlToUse.trim().replace(/\/+$/, "")}/update-config.php`
      })
    }
  } else {
    console.log('⚠️ frontendUrl не указан, пропускаю обновление config.json')
  }

  res.json({
    success: true,
    config: {
      id: config.id,
      backendApiUrl: config.backendApiUrl,
      frontendUrl: config.frontendUrl,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    }
  })
})
