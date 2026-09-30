import dotenv from "dotenv";
import { z } from "zod";
import path from "path";

// Load .env from repo root so both `npm run dev` and docker work the same way
dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // Server
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default("/api/v1"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // JWT
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  // CORS
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // Playwright
  PLAYWRIGHT_HEADLESS: z.string().default("false"),
  PLAYWRIGHT_SESSION_DIR: z.string().default(".sessions"),

  // Resume
  RESUME_FILE_PATH: z.string().default("./resumes/Rahul_Jangid_Resume.pdf"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌  Invalid environment variables:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
