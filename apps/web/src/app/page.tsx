import { redirect } from "next/navigation";

/**
 * Root page — redirect to dashboard (or login if not authenticated).
 * Auth guard will be added in the auth phase.
 */
export default function RootPage() {
  redirect("/dashboard");
}
