/**
 * @jobpilot/automation — public API surface.
 *
 * Import from here, not from internal files directly.
 * This lets us refactor internals without breaking callers.
 */

export { BrowserManager } from "./browser/BrowserManager.js";
export { LinkedInAuth } from "./linkedin/LinkedInAuth.js";
export { LinkedInJobSearch } from "./linkedin/LinkedInJobSearch.js";
export { LinkedInSelectors, LinkedInUrls, buildJobSearchUrl } from "./linkedin/LinkedInSelectors.js";
export { SessionManager } from "./session/SessionManager.js";

export type {
  BrowserConfig,
  BrowserSession,
  LaunchOptions,
  LoginResult,
  SessionCheckResult,
  StorageState,
  JobSearchParams,
  JobSearchResult,
  ScrapedJob,
} from "./types/automation.types.js";
