"use client";

import { CheckCircle2, XCircle, SkipForward, Clock, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApplicationCounts } from "@/hooks/useApi";

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  bg: string;
}

function StatCard({ label, value, icon, color, bg }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${bg}`}>
          <span className={color}>{icon}</span>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

interface StatsCardsProps {
  userId?: string;
}

export function StatsCards({ userId }: StatsCardsProps) {
  const { data, isLoading, isError } = useApplicationCounts(userId);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load stats. Make sure the API is running.
      </div>
    );
  }

  const stats: StatCardProps[] = [
    {
      label: "Applied",
      value: data.APPLIED,
      icon: <CheckCircle2 className="h-5 w-5" />,
      color: "text-green-600",
      bg: "bg-green-100",
    },
    {
      label: "In Progress",
      value: data.IN_PROGRESS,
      icon: <TrendingUp className="h-5 w-5" />,
      color: "text-blue-600",
      bg: "bg-blue-100",
    },
    {
      label: "Pending",
      value: data.PENDING,
      icon: <Clock className="h-5 w-5" />,
      color: "text-yellow-600",
      bg: "bg-yellow-100",
    },
    {
      label: "Skipped",
      value: data.SKIPPED,
      icon: <SkipForward className="h-5 w-5" />,
      color: "text-gray-500",
      bg: "bg-gray-100",
    },
    {
      label: "Failed",
      value: data.FAILED,
      icon: <XCircle className="h-5 w-5" />,
      color: "text-red-600",
      bg: "bg-red-100",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {stats.map((s) => (
        <StatCard key={s.label} {...s} />
      ))}
    </div>
  );
}
