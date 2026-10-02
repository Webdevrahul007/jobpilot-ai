/**
 * Test script: LinkedIn Login
 *
 * Usage:
 *   npm run test:login --workspace=workers/automation
 *
 * What it does:
 *   1. Launches Chromium (headed so you can watch)
 *   2. Navigates to LinkedIn login
 *   3. Fills credentials from .env
 *   4. Saves session to .sessions/
 *   5. Prints result and exits
 *
 * Expected output:
 *   ✅ Login successful — session saved
 *   Session file: .sessions/session_test-user.json
 */

import path from "path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { BrowserManager } from "../browser/BrowserManager.js";
import { LinkedInAuth } from "../linkedin/LinkedInAuth.js";
import { SessionManager } from "../session/SessionManager.js";

// Try repo root .env first, then cwd fallback
const repoRoot = path.resolve(__dirname, "../../../../");
dotenv.config({ path: path.join(repoRoot, ".env") });

console.log("📁 Loading .env from:", path.join(repoRoot, ".env"));

const TEST_USER_ID = "cmumodzni0000100dbd8zgny2";

async function main() {
  const email = process.env["LINKEDIN_EMAIL"];
  const password = process.env["LINKEDIN_PASSWORD"];

  // Resolve session dir — always absolute from repo root
  const sessionDir = process.env["PLAYWRIGHT_SESSION_DIR"]
    ? path.resolve(process.env["PLAYWRIGHT_SESSION_DIR"])
    : path.resolve(__dirname, "../../../../.sessions");
  const headless = process.env["PLAYWRIGHT_HEADLESS"] === "true";

  if (!email || !password) {
    console.error("❌ LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in .env");
    process.exit(1);
  }

  console.log("🚀 Starting LinkedIn login test");
  console.log(`   Email:    ${email}`);
  console.log(`   Headless: ${headless}`);
  console.log(`   Sessions: ${sessionDir}`);
  console.log("");

  const prisma = new PrismaClient();
  const browserManager = new BrowserManager({
    headless,
    slowMo: headless ? 0 : 50,
    sessionDir,
  });
  const sessionManager = new SessionManager(prisma, sessionDir);

  let exitCode = 0;

  try {
    // Check if a valid session already exists
    const hasSession = await sessionManager.hasValidSession(TEST_USER_ID);
    if (hasSession) {
      console.log("ℹ️  Valid session already exists. Testing restore...");
      const filePath = await sessionManager.restoreSession(TEST_USER_ID);
      console.log(`✅ Session restored: ${filePath}`);
      await prisma.$disconnect();
      return;
    }

    // Fresh login
    const session = await browserManager.newSession({ headless });
    const auth = new LinkedInAuth(session.page);

    console.log("🔐 Attempting login...\n");
    const result = await auth.login(email, password);

    if (result.success && result.sessionData) {
      await sessionManager.saveSession(TEST_USER_ID, result.sessionData);
      console.log("\n✅ Login successful — session saved");
      console.log(
        `   Session file: ${path.join(sessionDir, `session_${TEST_USER_ID}.json`)}`
      );
      console.log(
        `   Cookies: ${result.sessionData.cookies.length} saved`
      );
    } else {
      console.error("\n❌ Login failed:", result.error);
      exitCode = 1;
    }

    await browserManager.closeSession(session);
  } catch (err) {
    console.error("\n❌ Unexpected error:", err);
    exitCode = 1;
  } finally {
    await browserManager.closeBrowser();
    await prisma.$disconnect();
  }

  process.exit(exitCode);
}

main();
