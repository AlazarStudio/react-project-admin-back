import express from "express"

import { siteApiKey } from "../middleware/api-key.middleware.js"
import { admin, protect } from "../middleware/auth.middleware.js"
import { leadRateLimit } from "../middleware/rate-limit.middleware.js"

import {
  createLead,
  deleteLead,
  getLead,
  getLeads,
  updateLead,
} from "./lead.controller.js"

const router = express.Router()

router
  .route("/")
  // Приём заявки с сайта: без JWT, но обязателен заголовок x-api-key
  // и действует ограничение частоты по IP.
  //
  // Порядок важен: сначала ключ, потом лимит. При обратном порядке запрос
  // без ключа при исчерпанном лимите получал 429 вместо 401 — то есть аноним
  // узнавал о существовании лимитера и мог выжигать чужую квоту.
  .post(siteApiKey, leadRateLimit, createLead)
  .get(protect, admin, getLeads)

router
  .route("/:id")
  .get(protect, admin, getLead)
  .put(protect, admin, updateLead)
  .delete(protect, admin, deleteLead)

export default router
