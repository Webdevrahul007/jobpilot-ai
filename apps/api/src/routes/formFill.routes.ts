import { Router } from "express";
import {
  runFormFillHandler,
  getFormAnswersHandler,
} from "@/controllers/formFill.controller.js";

const router = Router();

/**
 * Form Fill Routes
 *
 * POST  /api/v1/form/fill                          — run form fill pipeline
 * GET   /api/v1/form/answers/:applicationId?userId= — get stored answers
 */
router.post("/fill", runFormFillHandler);
router.get("/answers/:applicationId", getFormAnswersHandler);

export default router;
