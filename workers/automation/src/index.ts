/**
 * @jobpilot/automation — public API surface.
 *
 * Import from here, not from internal files directly.
 * This lets us refactor internals without breaking callers.
 */

export { BrowserManager } from "./browser/BrowserManager.js";
export { LinkedInAuth } from "./linkedin/LinkedInAuth.js";
export { LinkedInEasyApplyDetector, detectBatch } from "./linkedin/LinkedInEasyApplyDetector.js";
export { LinkedInJobSearch } from "./linkedin/LinkedInJobSearch.js";
export { LinkedInResumeUploader } from "./linkedin/LinkedInResumeUploader.js";
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
  DetectionVerdict,
  DetectionResult,
  BatchDetectionResult,
  ResumeScenario,
  ResumeUploadResult,
} from "./types/automation.types.js";
