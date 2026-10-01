// ── Shared API response wrapper ──────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ── Application status ────────────────────────────────────────────────────────

export type ApplicationStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "APPLIED"
  | "SKIPPED"
  | "FAILED";

export type JobSource = "LINKEDIN" | "WELLFOUND" | "INDEED" | "NAUKRI" | "COMPANY_PAGE";

// ── Job Search ────────────────────────────────────────────────────────────────

export interface JobSearch {
  id: string;
  userId: string;
  name: string;
  keywords: string;
  location: string | null;
  remote: boolean;
  source: JobSource;
  isActive: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  jobSearchId: string;
  title: string;
  company: string;
  location: string | null;
  jobUrl: string;
  source: JobSource;
  isEasyApply: boolean;
  isRemote: boolean;
  salary: string | null;
  postedAt: string | null;
  createdAt: string;
  application?: { status: ApplicationStatus } | null;
}

export interface JobStats {
  total: number;
  easyApply: number;
  remote: number;
  applied: number;
  pending: number;
  failed: number;
  skipped: number;
}

// ── Application ───────────────────────────────────────────────────────────────

export interface Application {
  id: string;
  jobId: string;
  userId: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  failureReason: string | null;
  retryCount: number;
  screenshotUrl: string | null;
  createdAt: string;
  updatedAt: string;
  job?: {
    title: string;
    company: string;
    location: string | null;
    jobUrl: string;
    isEasyApply: boolean;
  };
}

export interface ApplicationCounts {
  PENDING: number;
  IN_PROGRESS: number;
  APPLIED: number;
  SKIPPED: number;
  FAILED: number;
}

export interface FormAnswer {
  id: string;
  applicationId: string;
  questionText: string;
  questionKey: string | null;
  answer: string;
  inputType: string | null;
  createdAt: string;
}

// ── Session ───────────────────────────────────────────────────────────────────

export interface SessionStatus {
  hasSession: boolean;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

// ── Submit run result ─────────────────────────────────────────────────────────

export interface RunResult {
  jobId: string;
  applicationId: string;
  success: boolean;
  outcome: string;
  stepsCompleted: number;
  fieldsFilled: number;
  retried: boolean;
  screenshotPath?: string;
  error?: string;
}

export interface SubmitRunSummary {
  processed: number;
  applied: number;
  failed: number;
  skipped: number;
  dryRun: boolean;
  results: RunResult[];
}
