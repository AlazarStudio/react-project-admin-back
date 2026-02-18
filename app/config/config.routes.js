import express from "express"
import { getConfig, updateConfig } from "./config.controller.js"

const router = express.Router()

router
  .route("/")
  .get(getConfig)
  .put(updateConfig)

export default router
