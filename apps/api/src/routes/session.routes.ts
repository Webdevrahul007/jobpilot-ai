import { Router } from "express";
import {
  loginHandler,
  statusHandler,
  verifyHandler,
  logoutHandler,
} from "@/controllers/session.controller.js";

const router = Router();

/**
 * LinkedIn Session Routes
 *
 * POST   /api/v1/linkedin/login          — trigger login, save session
 * GET    /api/v1/linkedin/status/:userId — fast DB status check
 * GET    /api/v1/linkedin/verify/:userId — live browser session check
 * POST   /api/v1/linkedin/logout         — logout + invalidate session
 */
router.post("/login", loginHandler);
router.get("/status/:userId", statusHandler);
router.get("/verify/:userId", verifyHandler);
router.post("/logout", logoutHandler);

export default router;
