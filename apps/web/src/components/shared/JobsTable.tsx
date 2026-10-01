"use client";

import { useState } from "react";
import { ExternalLink, Filter, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "./StatusBadge";
import { Pagination } from "./Pagination";
import { useJobs, useJobStats } from "@/hooks/useApi";
import { DEV_USER_ID } from "@/lib/api";

interface JobsTableProps {
  searchId: string;
  userId?: string;
}

export function JobsTable({ searchId, userId = DEV_USER_ID }: JobsTableProps) {
  const [page, setPage] = useState(1);
  const [easyApplyFilter, setEasyApplyFilter] = useState<"all" | "easy" | "external">("all");

  const filters = {
    page,
    pageSize: 20,
    ...(easyApplyFilter === "easy" && { isEasyApply: true }),
    ...(easyApplyFilter === "external" && { isEasyApply: false }),
  };

  const { data, isLoading } = useJobs(searchId, userId, filters);
  const { data: stats } = useJobStats(searchId, userId);

  const handleFilterChange = (val: string) => {
    setEasyApplyFilter(val as "all" | "easy" | "external");
    setPage(1);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Collected Jobs</CardTitle>
            {stats && (
              <div className="flex items-center gap-2">
                <Badge variant="outline">{stats.total} total</Badge>
                <Badge variant="info">
                  <Zap className="mr-1 h-3 w-3" />
                  {stats.easyApply} Easy Apply
                </Badge>
                {stats.applied > 0 && (
                  <Badge variant="success">{stats.applied} applied</Badge>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={easyApplyFilter} onValueChange={handleFilterChange}>
              <SelectTrigger className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Jobs</SelectItem>
                <SelectItem value="easy">Easy Apply</SelectItem>
                <SelectItem value="external">External Apply</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading && (
          <div className="space-y-0 divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && (!data?.jobs || data.jobs.length === 0) && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No jobs collected yet. Click "Collect Jobs" to run a search.
          </div>
        )}

        {!isLoading && data && data.jobs.length > 0 && (
          <>
            <div className="divide-y divide-border">
              {data.jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={job.jobUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate font-medium hover:text-primary hover:underline"
                      >
                        {job.title}
                      </a>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                      {job.isEasyApply && (
                        <Badge variant="info" className="shrink-0 text-xs">
                          <Zap className="mr-1 h-3 w-3" />
                          Easy Apply
                        </Badge>
                      )}
                      {job.isRemote && (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          Remote
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {job.company}
                      {job.location && ` · ${job.location}`}
                      {job.salary && ` · ${job.salary}`}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {job.application ? (
                      <StatusBadge status={job.application.status} />
                    ) : (
                      <Badge variant="outline" className="text-xs">Not processed</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              pageSize={data.pageSize}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
