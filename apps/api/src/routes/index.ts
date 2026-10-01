import { Router } from "express";
import healthRoutes from "./health.routes.js";
import sessionRoutes from "./session.routes.js";
import jobRoutes from "./job.routes.js";
import detectionRoutes from "./detection.routes.js";
import resumeRoutes from "./resume.routes.js";
import formFillRoutes from "./formFill.routes.js";
import submitRoutes from "./submit.routes.js";

const router = Router();

router.use("/health", healthRoutes);
router.use("/linkedin", sessionRoutes);
router.use("/jobs", jobRoutes);
router.use("/detect", detectionRoutes);
router.use("/resume", resumeRoutes);
router.use("/form", formFillRoutes);
router.use("/apply", submitRoutes);

// Future:
// router.use("/auth", authRoutes);

export default router;
