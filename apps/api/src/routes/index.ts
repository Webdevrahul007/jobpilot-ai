import { Router } from "express";
import healthRoutes from "./health.routes.js";
import sessionRoutes from "./session.routes.js";
import jobRoutes from "./job.routes.js";

const router = Router();

// Mount all API routes here — one place to see the full API surface
router.use("/health", healthRoutes);
router.use("/linkedin", sessionRoutes);
router.use("/jobs", jobRoutes);

// Future routes:
// router.use("/auth", authRoutes);
// router.use("/applications", applicationRoutes);

export default router;
