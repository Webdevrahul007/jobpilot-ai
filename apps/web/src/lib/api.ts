import axios from "axios";
import type {
  ApiResponse,
  JobSearch,
  Job,
  JobStats,
  Application,
  ApplicationCounts,
  FormAnswer,
  SessionStatus,
  SubmitRunSummary,
} from "@/types/api";

/**
 * Axios instance for the JobPilot API.
 * Base URL reads from env — falls back to localhost for dev.
 */
export const api = axios.create({
  baseURL: process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000/api/v1",
  headers: { "Content-Type": "application/json" },
  timeout: 120_000, // 2 min — browser runs can be slow
});

// ── Dev user ID ───────────────────────────────────────────────────────────────
// Replaced by real auth in a later phase.
// Set this to the id from your seeded user: rahul@jobpilot.dev
export const DEV_USER_ID =
  process.env["NEXT_PUBLIC_DEV_USER_ID"] ?? "REPLACE_WITH_YOUR_USER_ID";

// ── Session ───────────────────────────────────────────────────────────────────

export const sessionApi = {
  getStatus: (userId: string) =>
    api.get<ApiResponse<SessionStatus>>(`/linkedin/status/${userId}`).then((r) => r.data.data!),

  verify: (userId: string) =>
    api.get<ApiResponse<{ isValid: boolean; username?: string }>>(`/linkedin/verify/${userId}`).then((r) => r.data.data!),

  login: (userId: string, email: string, password: string) =>
    api.post<ApiResponse<{ message: string; expiresAt: string }>>("/linkedin/login", { userId, email, password }).then((r) => r.data),

  logout: (userId: string) =>
    api.post<ApiResponse<null>>("/linkedin/logout", { userId }).then((r) => r.data),
};

// ── Job Searches ──────────────────────────────────────────────────────────────

export const jobSearchApi = {
  list: (userId: string) =>
    api.get<ApiResponse<JobSearch[]>>("/jobs/searches", { params: { userId } }).then((r) => r.data.data!),

  create: (payload: { userId: string; name: string; keywords: string; location?: string; remote?: boolean }) =>
    api.post<ApiResponse<JobSearch>>("/jobs/searches", payload).then((r) => r.data.data!),

  delete: (searchId: string, userId: string) =>
    api.delete<ApiResponse<null>>(`/jobs/searches/${searchId}`, { params: { userId } }).then((r) => r.data),

  run: (searchId: string, userId: string, maxPages?: number) =>
    api.post<ApiResponse<unknown>>(`/jobs/searches/${searchId}/run`, { userId, maxPages }).then((r) => r.data),

  getStats: (searchId: string, userId: string) =>
    api.get<ApiResponse<JobStats>>(`/jobs/searches/${searchId}/stats`, { params: { userId } }).then((r) => r.data.data!),
};

// ── Jobs ──────────────────────────────────────────────────────────────────────

export const jobsApi = {
  list: (searchId: string, userId: string, params?: { isEasyApply?: boolean; page?: number; pageSize?: number }) =>
    api
      .get<ApiResponse<{ jobs: Job[]; total: number; page: number; pageSize: number; totalPages: number }>>(
        `/jobs/searches/${searchId}/jobs`,
        { params: { userId, ...params } }
      )
      .then((r) => r.data.data!),
};

// ── Detection ─────────────────────────────────────────────────────────────────

export const detectApi = {
  run: (searchId: string, userId: string, concurrency?: number, limit?: number) =>
    api.post<ApiResponse<unknown>>(`/detect/searches/${searchId}/run`, { userId, concurrency, limit }).then((r) => r.data),

  listApplications: (userId: string, params?: { status?: string; page?: number; pageSize?: number }) =>
    api
      .get<ApiResponse<{ applications: Application[]; total: number; page: number; pageSize: number; totalPages: number }>>(
        "/detect/applications",
        { params: { userId, ...params } }
      )
      .then((r) => r.data),

  getCounts: (userId: string) =>
    api.get<ApiResponse<ApplicationCounts>>("/detect/applications/counts", { params: { userId } }).then((r) => r.data.data!),

  getFormAnswers: (applicationId: string, userId: string) =>
    api.get<ApiResponse<FormAnswer[]>>(`/form/answers/${applicationId}`, { params: { userId } }).then((r) => r.data.data!),
};

// ── Apply ─────────────────────────────────────────────────────────────────────

export const applyApi = {
  run: (payload: { userId: string; jobSearchId?: string; jobId?: string; limit?: number; dryRun?: boolean }) =>
    api.post<ApiResponse<SubmitRunSummary>>("/apply/run", payload).then((r) => r.data),

  getStats: (userId: string) =>
    api.get<ApiResponse<ApplicationCounts>>("/apply/stats", { params: { userId } }).then((r) => r.data.data!),
};

// ── Resume ────────────────────────────────────────────────────────────────────

export const resumeApi = {
  getStatus: () =>
    api.get<ApiResponse<{ exists: boolean; path: string; fileName: string }>>("/resume/status").then((r) => r.data.data!),
};
