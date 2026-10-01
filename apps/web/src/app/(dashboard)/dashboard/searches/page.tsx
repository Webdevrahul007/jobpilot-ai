"use client";

import { useState } from "react";
import { JobSearchManager } from "@/components/shared/JobSearchManager";
import { JobsTable } from "@/components/shared/JobsTable";
import { DEV_USER_ID } from "@/lib/api";

export default function SearchesPage() {
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Job Searches</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your search configs and collect jobs from LinkedIn
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <JobSearchManager
            userId={DEV_USER_ID}
            onSearchSelect={setSelectedSearchId}
            selectedSearchId={selectedSearchId ?? undefined}
          />
        </div>

        <div className="xl:col-span-2">
          {selectedSearchId ? (
            <JobsTable searchId={selectedSearchId} userId={DEV_USER_ID} />
          ) : (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              Select a search to view its jobs
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
