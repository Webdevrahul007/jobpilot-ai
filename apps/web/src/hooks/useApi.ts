"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { jobSearchApi, jobsApi, detectApi, applyApi, resumeApi, sessionApi, DEV_USER_ID } from "@/lib/api";
import type { ApplicationStatus } from "@/types/api";

// ── Query keys — centralised so cache invalidations are consistent ────────────

export const QK = {
  session: (userId: string) => ["session", userId] as const,
  searches: (userId: string) => ["searches", userId] as const,
  jobs: (searchId: string, filters?: object) => ["jobs", searchId, filters] as const,
  jobStats: (searchId: string) => ["jobStats", searchId] as const,
  applications: (userId: string, filters?: object) => ["applications", userId, filters] as const,
  appCounts: (userId: string) => ["appCounts", userId] as const,
  formAnswers: (appId: string) => ["formAnswers", appId] as const,
  resume: () => ["resume"] as const,
};

// ── Session hooks ─────────────────────────────────────────────────────────────

export function useSessionStatus(userId = DEV_USER_ID) {
  return useQuery({
    queryKey: QK.session(userId),
    queryFn: () => sessionApi.getStatus(userId),
    refetchInterval: 5 * 60 * 1000, // refresh every 5 min
  });
}

// ── Job Search hooks ──────────────────────────────────────────────────────────

export function useSearches(userId = DEV_USER_ID) {
  return useQuery({
    queryKey: QK.searches(userId),
    queryFn: () => jobSearchApi.list(userId),
  });
}

export function useCreateSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: jobSearchApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["searches"] });
      toast.success("Job search created");
    },
    onError: () => toast.error("Failed to create job search"),
  });
}

export function useDeleteSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ searchId, userId }: { searchId: string; userId: string }) =>
      jobSearchApi.delete(searchId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["searches"] });
      toast.success("Job search deleted");
    },
    onError: () => toast.error("Failed to delete search"),
  });
}

export function useRunSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ searchId, userId, maxPages }: { searchId: string; userId: string; maxPages?: number }) =>
      jobSearchApi.run(searchId, userId, maxPages),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["jobs", vars.searchId] });
      qc.invalidateQueries({ queryKey: ["jobStats", vars.searchId] });
      toast.success("Search run complete — jobs collected");
    },
    onError: () => toast.error("Search run failed"),
  });
}

// ── Jobs hooks ────────────────────────────────────────────────────────────────

export function useJobs(
  searchId: string,
  userId = DEV_USER_ID,
  filters?: { isEasyApply?: boolean; page?: number; pageSize?: number }
) {
  return useQuery({
    queryKey: QK.jobs(searchId, filters),
    queryFn: () => jobsApi.list(searchId, userId, filters),
    enabled: !!searchId,
  });
}

export function useJobStats(searchId: string, userId = DEV_USER_ID) {
  return useQuery({
    queryKey: QK.jobStats(searchId),
    queryFn: () => jobSearchApi.getStats(searchId, userId),
    enabled: !!searchId,
  });
}

// ── Application hooks ─────────────────────────────────────────────────────────

export function useApplicationCounts(userId = DEV_USER_ID) {
  return useQuery({
    queryKey: QK.appCounts(userId),
    queryFn: () => detectApi.getCounts(userId),
    refetchInterval: 30_000, // auto-refresh every 30s — dashboard stat cards
  });
}

export function useApplications(
  userId = DEV_USER_ID,
  filters?: { status?: ApplicationStatus; page?: number; pageSize?: number }
) {
  return useQuery({
    queryKey: QK.applications(userId, filters),
    queryFn: () => detectApi.listApplications(userId, filters),
    select: (data) => data.data,
  });
}

export function useFormAnswers(applicationId: string, userId = DEV_USER_ID) {
  return useQuery({
    queryKey: QK.formAnswers(applicationId),
    queryFn: () => detectApi.getFormAnswers(applicationId, userId),
    enabled: !!applicationId,
  });
}

// ── Apply hooks ───────────────────────────────────────────────────────────────

export function useRunDetection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ searchId, userId }: { searchId: string; userId: string }) =>
      detectApi.run(searchId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appCounts"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      toast.success("Detection run complete");
    },
    onError: () => toast.error("Detection failed"),
  });
}

export function useRunApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: applyApi.run,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["appCounts"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      const d = data.data;
      if (d) {
        toast.success(`Applied: ${d.applied} | Failed: ${d.failed} | Skipped: ${d.skipped}`);
      }
    },
    onError: () => toast.error("Apply run failed"),
  });
}

// ── Resume hook ───────────────────────────────────────────────────────────────

export function useResumeStatus() {
  return useQuery({
    queryKey: QK.resume(),
    queryFn: resumeApi.getStatus,
    retry: false,
  });
}
