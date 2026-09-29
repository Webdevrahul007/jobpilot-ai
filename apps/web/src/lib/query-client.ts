import { QueryClient } from "@tanstack/react-query";

/**
 * Singleton QueryClient — shared across the app.
 * These defaults are production-tuned:
 * - staleTime 60s: avoids redundant refetches on tab focus
 * - retry 1: fail fast on hard errors, retry once for transient network issues
 * - refetchOnWindowFocus false: prevents surprise refetches mid-form
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
