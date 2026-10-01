"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Search, FileText,
  Settings, Wifi, WifiOff, Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionStatus, useResumeStatus } from "@/hooks/useApi";
import { DEV_USER_ID } from "@/lib/api";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/searches", label: "Job Searches", icon: Search },
  { href: "/dashboard/applications", label: "Applications", icon: FileText },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

function SessionIndicator() {
  const { data: session } = useSessionStatus(DEV_USER_ID);

  if (!session) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-xs",
        session.isActive
          ? "bg-green-50 text-green-700"
          : "bg-red-50 text-red-600"
      )}
    >
      {session.isActive ? (
        <Wifi className="h-3.5 w-3.5" />
      ) : (
        <WifiOff className="h-3.5 w-3.5" />
      )}
      <span>LinkedIn {session.isActive ? "Connected" : "Not connected"}</span>
    </div>
  );
}

function ResumeIndicator() {
  const { data: resume } = useResumeStatus();

  if (!resume) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs",
        resume.exists ? "text-green-700" : "text-red-600"
      )}
    >
      <FileText className="h-3.5 w-3.5" />
      <span className="truncate">
        {resume.exists ? resume.fileName : "Resume missing"}
      </span>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full flex-col border-r border-border bg-card">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Bot className="h-5 w-5 text-primary" />
        <span className="font-bold">JobPilot AI</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Status footer */}
      <div className="space-y-1 border-t border-border px-3 py-3">
        <SessionIndicator />
        <ResumeIndicator />
      </div>
    </aside>
  );
}
