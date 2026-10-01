"use client";

import { useState } from "react";
import {
  ExternalLink, ChevronDown, ChevronUp,
  AlertCircle, CheckCircle2, Clock, Filter,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "./StatusBadge";
import { Pagination } from "./Pagination";
import { useApplications, useFormAnswers } from "@/hooks/useApi";
import { DEV_USER_ID } from "@/lib/api";
import type { Application, ApplicationStatus } from "@/types/api";

// ── Form Answers drill-down ───────────────────────────────────────────────────

function FormAnswersPanel({
  applicationId,
  userId,
}: {
  applicationId: string;
  userId: string;
}) {
  const { data: answers, isLoading } = useFormAnswers(applicationId, userId);

  if (isLoading) {
    return (
      <div className="space-y-2 px-6 pb-4 pt-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    );
  }

  if (!answers || answers.length === 0) {
    return (
      <p className="px-6 pb-4 pt-2 text-xs text-muted-foreground">
        No form answers recorded for this application.
      </p>
    );
  }

  return (
    <div className="px-6 pb-4 pt-2">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Form answers ({answers.length} fields filled)
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {answers.map((a) => (
          <div
            key={a.id}
            className="rounded-md bg-muted/60 px-3 py-2 text-xs"
          >
            <span className="font-medium text-foreground">{a.questionText}</span>
            <span className="mx-1 text-muted-foreground">→</span>
            <span className="text-foreground">{a.answer}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Application row ───────────────────────────────────────────────────────────

function ApplicationRow({
  app,
  userId,
}: {
  app: Application;
  userId: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const canExpand =
    app.status === "APPLIED" ||
    app.status === "IN_PROGRESS" ||
    app.status === "FAILED";

  return (
    <div className="border-b border-border last:border-0">
      {/* Main row */}
      <div className="flex flex-col gap-2 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {app.job ? (
              <a
                href={app.job.jobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-medium hover:text-primary hover:underline"
              >
                {app.job.title}
              </a>
            ) : (
              <span className="truncate font-medium text-muted-foreground">
                {app.jobId}
              </span>
            )}
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {app.job?.company && <span>{app.job.company}</span>}
            {app.job?.location && <span>· {app.job.location}</span>}
            {app.appliedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                Applied {new Date(app.appliedAt).toLocaleDateString()}
              </span>
            )}
            {!app.appliedAt && app.createdAt && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(app.createdAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Failure reason */}
          {app.failureReason && (
            <div className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{app.failureReason}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={app.status} />

          {canExpand && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? "Collapse" : "Expand form answers"}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Expandable form answers */}
      {expanded && canExpand && (
        <div className="border-t border-border/50 bg-muted/20">
          <FormAnswersPanel applicationId={app.id} userId={userId} />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ApplicationsTableProps {
  userId?: string;
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All Status" },
  { value: "APPLIED", label: "Applied" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "PENDING", label: "Pending" },
  { value: "SKIPPED", label: "Skipped" },
  { value: "FAILED", label: "Failed" },
];

export function ApplicationsTable({ userId = DEV_USER_ID }: ApplicationsTableProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);

  const filters = {
    page,
    pageSize: 20,
    ...(statusFilter !== "all" && { status: statusFilter as ApplicationStatus }),
  };

  const { data, isLoading } = useApplications(userId, filters);

  const handleFilterChange = (val: string) => {
    setStatusFilter(val);
    setPage(1);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Application History</CardTitle>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={statusFilter} onValueChange={handleFilterChange}>
              <SelectTrigger className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading && (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-56" />
                  <Skeleton className="h-3 w-36" />
                </div>
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && (!data?.applications || data.applications.length === 0) && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {statusFilter !== "all"
              ? `No ${statusFilter.toLowerCase()} applications found.`
              : "No applications yet. Run detection and apply to see history here."}
          </div>
        )}

        {!isLoading && data && data.applications.length > 0 && (
          <>
            <div>
              {data.applications.map((app) => (
                <ApplicationRow key={app.id} app={app} userId={userId} />
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
