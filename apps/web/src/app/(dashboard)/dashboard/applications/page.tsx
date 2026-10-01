import type { Metadata } from "next";
import { ApplicationsTable } from "@/components/shared/ApplicationsTable";
import { StatsCards } from "@/components/shared/StatsCards";
import { DEV_USER_ID } from "@/lib/api";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Full history of every job application attempt
        </p>
      </div>
      <StatsCards userId={DEV_USER_ID} />
      <ApplicationsTable userId={DEV_USER_ID} />
    </div>
  );
}
