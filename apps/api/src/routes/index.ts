import { Router } from "express";
import healthRoutes from "./health.routes.js";
import sessionRoutes from "./session.routes.js";
import jobRoutes from "./job.routes.js";
import detectionRoutes from "./detection.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/linkedin", sessionRoutes);
router.use("/jobs", jobRoutes);
router.use("/detect", detectionRoutes);

// Future:
// router.use("/auth", authRoutes);
// router.use("/applications", applicationRoutes);

export default router;
