import axios from "axios";

/**
 * Axios instance pre-configured for the JobPilot API.
 * All API calls go through here — makes it trivial to:
 * - Add auth headers globally
 * - Handle 401 redirects globally
 * - Swap base URL for different environments
 */
export const apiClient = axios.create({
  baseURL: process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000/api/v1",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30_000,
});

// Request interceptor — attach JWT from localStorage if present
apiClient.interceptors.request.use(
  (config) => {
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("jobpilot_token");
      if (token) {
        config.headers["Authorization"] = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error: unknown) => Promise.reject(error)
);

// Response interceptor — redirect to login on 401
apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("jobpilot_token");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);
