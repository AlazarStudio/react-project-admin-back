import asyncHandler from "express-async-handler"

import { prisma } from "../prisma.js"
import {
  badRequest,
  buildPagination,
  getSearchParam,
  getStringParam,
  has,
  parsePagination,
  toTrimmedString,
} from "../utils/http.utils.js"

const LEAD_STATUSES = ["NEW", "IN_PROGRESS", "DONE", "SPAM"]

const MAX_LENGTHS = {
  name: 200,
  phone: 50,
  comment: 4000,
  source: 200,
  page: 500,
  utm: 1000,
}

/**
 * IP клиента. За обратным прокси нужен TRUST_PROXY=1 в .env — тогда express
 * сам разбирает X-Forwarded-For и req.ip содержит реальный адрес.
 */
function clientIp(req) {
  return toTrimmedString(req.ip) || toTrimmedString(req.socket?.remoteAddress) || null
}

function optionalField(body, field) {
  const value = toTrimmedString(body[field])
  if (!value) return null
  return value.slice(0, MAX_LENGTHS[field])
}

// @desc    Create lead from the website
// @route   POST /api/leads
// @access  Public + x-api-key (SITE_API_KEY), с ограничением частоты
export const createLead = asyncHandler(async (req, res) => {
  const body = req.body || {}

  const name = toTrimmedString(body.name)
  const phone = toTrimmedString(body.phone)
  const errors = []

  if (!name) errors.push("name is required")
  else if (name.length > MAX_LENGTHS.name) errors.push("name is too long")

  if (!phone) errors.push("phone is required")
  else if (phone.replace(/\D/g, "").length < 6) errors.push("phone must contain at least 6 digits")
  else if (phone.length > MAX_LENGTHS.phone) errors.push("phone is too long")

  if (errors.length > 0) {
    throw badRequest(errors.join(", "))
  }

  const lead = await prisma.lead.create({
    data: {
      name: name.slice(0, MAX_LENGTHS.name),
      phone,
      comment: optionalField(body, "comment"),
      source: optionalField(body, "source"),
      page: optionalField(body, "page"),
      utm: optionalField(body, "utm"),
      ip: clientIp(req),
    },
  })

  res.status(201).json({ id: lead.id, status: lead.status, createdAt: lead.createdAt })
})

// @desc    Get leads
// @route   GET /api/leads?page=1&limit=20&status=NEW&search=
// @access  Private (Admin)
export const getLeads = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 })

  const where = {}

  const status = getStringParam(req.query, "status").toUpperCase()
  if (status) {
    if (!LEAD_STATUSES.includes(status)) {
      throw badRequest(`status must be one of: ${LEAD_STATUSES.join(", ")}`)
    }
    where.status = status
  }

  const search = getSearchParam(req.query)
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { comment: { contains: search, mode: "insensitive" } },
    ]
  }

  const [items, total, counts] = await Promise.all([
    prisma.lead.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
  ])

  res.json({
    items,
    pagination: buildPagination({ page, limit, total }),
    counts: Object.fromEntries(
      LEAD_STATUSES.map((value) => [
        value,
        counts.find((row) => row.status === value)?._count?._all || 0,
      ])
    ),
  })
})

// @desc    Get lead by id
// @route   GET /api/leads/:id
// @access  Private (Admin)
export const getLead = asyncHandler(async (req, res) => {
  const lead = await prisma.lead.findUnique({ where: { id: req.params.id } })

  if (!lead) {
    res.status(404)
    throw new Error("Lead not found")
  }

  res.json(lead)
})

// @desc    Update lead (обычно — смена статуса или заметка)
// @route   PUT /api/leads/:id
// @access  Private (Admin)
export const updateLead = asyncHandler(async (req, res) => {
  const existing = await prisma.lead.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("Lead not found")
  }

  const data = {}

  if (has(req.body, "status")) {
    const status = toTrimmedString(req.body.status).toUpperCase()
    if (!LEAD_STATUSES.includes(status)) {
      throw badRequest(`status must be one of: ${LEAD_STATUSES.join(", ")}`)
    }
    data.status = status
  }

  for (const field of ["name", "phone", "comment", "source", "page", "utm"]) {
    if (has(req.body, field)) data[field] = optionalField(req.body, field)
  }

  if (has(req.body, "name") && !data.name) {
    throw badRequest('Field "name" must be a non-empty string')
  }
  if (has(req.body, "phone") && !data.phone) {
    throw badRequest('Field "phone" must be a non-empty string')
  }

  const lead = await prisma.lead.update({ where: { id: existing.id }, data })

  res.json(lead)
})

// @desc    Delete lead
// @route   DELETE /api/leads/:id
// @access  Private (Admin)
export const deleteLead = asyncHandler(async (req, res) => {
  const existing = await prisma.lead.findUnique({ where: { id: req.params.id } })

  if (!existing) {
    res.status(404)
    throw new Error("Lead not found")
  }

  await prisma.lead.delete({ where: { id: existing.id } })

  res.json({ message: "Lead deleted successfully", id: existing.id })
})
