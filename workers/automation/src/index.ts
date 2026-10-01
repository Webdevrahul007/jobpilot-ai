/**
 * @jobpilot/automation — public API surface.
 *
 * Import from here, not from internal files directly.
 * This lets us refactor internals without breaking callers.
 */

export { BrowserManager } from "./browser/BrowserManager.js";
export { LinkedInAuth } from "./linkedin/LinkedInAuth.js";
export { LinkedInEasyApplyDetector, detectBatch } from "./linkedin/LinkedInEasyApplyDetector.js";
export { LinkedInFormFiller } from "./linkedin/LinkedInFormFiller.js";
export { LinkedInJobSearch } from "./linkedin/LinkedInJobSearch.js";
export { LinkedInResumeUploader } from "./linkedin/LinkedInResumeUploader.js";
export { LinkedInSubmitter } from "./linkedin/LinkedInSubmitter.js";
export { LinkedInSelectors, LinkedInUrls, buildJobSearchUrl } from "./linkedin/LinkedInSelectors.js";
export { SessionManager } from "./session/SessionManager.js";
export { FieldDetector } from "./linkedin/FieldDetector.js";
export { AnswerResolver } from "./linkedin/AnswerResolver.js";

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
  FilledField,
  FormFillResult,
  SubmitOutcome,
  SubmitResult,
  ApplicationRunResult,
} from "./types/automation.types.js";

export type { UserProfileData, StoredAnswers } from "./linkedin/AnswerResolver.js";
export type { DetectedField, FieldType } from "./linkedin/FieldDetector.js";
