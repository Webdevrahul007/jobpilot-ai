export const CONSTANTS = {
  // Pagination defaults
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: 100,

  // Job application statuses — single source of truth
  JOB_STATUS: {
    PENDING: "PENDING",
    APPLIED: "APPLIED",
    SKIPPED: "SKIPPED",
    FAILED: "FAILED",
  } as const,

  // LinkedIn
  LINKEDIN_BASE_URL: "https://www.linkedin.com",
  LINKEDIN_JOBS_URL: "https://www.linkedin.com/jobs/search",

  // File paths
  RESUME_FILENAME: "Rahul_Jangid_Resume.pdf",
} as const;

export type JobStatus = (typeof CONSTANTS.JOB_STATUS)[keyof typeof CONSTANTS.JOB_STATUS];
