import { Router } from "express";
import healthRoutes from "./health.routes.js";
import sessionRoutes from "./session.routes.js";

const router = Router();

// Mount all API routes here — one place to see the full API surface
router.use("/health", healthRoutes);
router.use("/linkedin", sessionRoutes);

// Future routes will be mounted here:
// router.use("/auth", authRoutes);
// router.use("/jobs", jobRoutes);
// router.use("/applications", applicationRoutes);

export default router;
