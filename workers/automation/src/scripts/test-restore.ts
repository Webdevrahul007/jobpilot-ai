/**
 * Test script: Session Restore
 *
 * Usage:
 *   npm run test:restore --workspace=workers/automation
 *
 * Run AFTER test-login.ts has saved a session.
 *
 * What it does:
 *   1. Pulls saved session from DB
 *   2. Writes it to disk cache
 *   3. Launches browser with pre-loaded session
 *   4. Navigates to LinkedIn feed
 *   5. Verifies the global nav is visible (proves we're logged in)
 *   6. Prints the display name found in the nav
 *
 * Expected output:
 *   ✅ Session restored — logged in as Rahul Jangid
 */

import path from "path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { BrowserManager } from "../browser/BrowserManager.js";
import { LinkedInAuth } from "../linkedin/LinkedInAuth.js";
import { SessionManager } from "../session/SessionManager.js";

dotenv.config({ path: path.resolve(__dirname, "../../../../.env") });

const TEST_USER_ID = "test-user";

async function main() {
  const sessionDir = path.resolve(
    process.env["PLAYWRIGHT_SESSION_DIR"] ?? ".sessions"
  );
  const headless = process.env["PLAYWRIGHT_HEADLESS"] === "true";

  console.log("🔄 Testing session restore");
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
    // Pull session from DB and write to disk
    const sessionFilePath = await sessionManager.restoreSession(TEST_USER_ID);

    if (!sessionFilePath) {
      console.error(
        "❌ No valid session found. Run test-login.ts first."
      );
      await prisma.$disconnect();
      process.exit(1);
    }

    console.log(`📂 Session file: ${sessionFilePath}`);

    // Launch browser with pre-loaded session
    const session = await browserManager.newSession({
      storageStatePath: sessionFilePath,
      headless,
    });

    const auth = new LinkedInAuth(session.page);

    console.log("🔍 Checking session validity on LinkedIn...\n");
    const result = await auth.checkSession();

    if (result.isLoggedIn) {
      console.log(`✅ Session restored — logged in${result.username ? ` as ${result.username}` : ""}`);
    } else {
      console.error("❌ Session invalid — not logged in. Need to re-login.");
      // Invalidate the stale session so next run forces fresh login
      await sessionManager.invalidateSession(TEST_USER_ID);
      exitCode = 1;
    }

    await browserManager.closeSession(session);
  } catch (err) {
    console.error("❌ Unexpected error:", err);
    exitCode = 1;
  } finally {
    await browserManager.closeBrowser();
    await prisma.$disconnect();
  }

  process.exit(exitCode);
}

main();
