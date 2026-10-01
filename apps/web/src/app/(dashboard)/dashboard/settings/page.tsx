"use client";

import type { Metadata } from "next";
import { FileText, Wifi, WifiOff, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSessionStatus, useResumeStatus } from "@/hooks/useApi";
import { DEV_USER_ID } from "@/lib/api";

function ResumeCard() {
  const { data, isLoading } = useResumeStatus();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4" />
          Resume File
        </CardTitle>
        <CardDescription>
          This PDF is uploaded for every Easy Apply application. Never changed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-10 w-full" />}
        {!isLoading && data && (
          <div className="flex items-center gap-3 rounded-lg border border-border p-4">
            {data.exists ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 shrink-0 text-destructive" />
            )}
            <div>
              <p className="font-medium">{data.fileName}</p>
              <p className="text-xs text-muted-foreground">{data.path}</p>
            </div>
            <Badge
              variant={data.exists ? "success" : "destructive"}
              className="ml-auto shrink-0"
            >
              {data.exists ? "Ready" : "Missing"}
            </Badge>
          </div>
        )}
        {!isLoading && !data && (
          <p className="text-sm text-destructive">
            Could not check resume status. Make sure the API is running.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SessionCard() {
  const { data, isLoading } = useSessionStatus(DEV_USER_ID);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {data?.isActive ? (
            <Wifi className="h-4 w-4 text-green-500" />
          ) : (
            <WifiOff className="h-4 w-4 text-muted-foreground" />
          )}
          LinkedIn Session
        </CardTitle>
        <CardDescription>
          Active session means the bot can log in without credentials.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <Skeleton className="h-16 w-full" />}
        {!isLoading && data && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={data.isActive ? "success" : "secondary"}>
                {data.isActive ? "Active" : "Not connected"}
              </Badge>
            </div>
            {data.lastUsedAt && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last used</span>
                <span className="flex items-center gap-1 text-sm">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  {new Date(data.lastUsedAt).toLocaleString()}
                </span>
              </div>
            )}
            {data.expiresAt && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Expires</span>
                <span className="text-sm">
                  {new Date(data.expiresAt).toLocaleDateString()}
                </span>
              </div>
            )}
            {!data.hasSession && (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                No active session. Use the API to log in to LinkedIn first:
                <br />
                <code className="mt-1 block font-mono text-xs">
                  POST /api/v1/linkedin/login
                </code>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UserCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account</CardTitle>
        <CardDescription>Current user running the automation</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm font-medium">rahul@jobpilot.dev</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">User ID</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {DEV_USER_ID}
            </code>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Resume file, LinkedIn session, and account info
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ResumeCard />
        <SessionCard />
        <UserCard />
      </div>
    </div>
  );
}
