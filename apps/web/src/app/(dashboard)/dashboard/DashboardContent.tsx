"use client";

import { useState } from "react";
import { StatsCards } from "@/components/shared/StatsCards";
import { JobSearchManager } from "@/components/shared/JobSearchManager";
import { JobsTable } from "@/components/shared/JobsTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DEV_USER_ID } from "@/lib/api";

export function DashboardContent() {
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor your automated job applications
        </p>
      </div>

      {/* Stats row */}
      <StatsCards userId={DEV_USER_ID} />

      {/* Main content */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Left: search manager */}
        <div className="xl:col-span-1">
          <JobSearchManager
            userId={DEV_USER_ID}
            onSearchSelect={setSelectedSearchId}
            selectedSearchId={selectedSearchId ?? undefined}
          />
        </div>

        {/* Right: jobs table */}
        <div className="xl:col-span-2">
          {selectedSearchId ? (
            <JobsTable searchId={selectedSearchId} userId={DEV_USER_ID} />
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              Select a job search to view collected jobs
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
