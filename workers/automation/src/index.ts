/**
 * @jobpilot/automation — public API surface.
 *
 * Import from here, not from internal files directly.
 * This lets us refactor internals without breaking callers.
 */

export { BrowserManager } from "./browser/BrowserManager.js";
export { LinkedInAuth } from "./linkedin/LinkedInAuth.js";
export { LinkedInSelectors, LinkedInUrls } from "./linkedin/LinkedInSelectors.js";
export { SessionManager } from "./session/SessionManager.js";

export type {
  BrowserConfig,
  BrowserSession,
  LaunchOptions,
  LoginResult,
  SessionCheckResult,
  StorageState,
} from "./types/automation.types.js";
