import type { ReactNode } from "react";

/**
 * Dashboard layout — wraps all protected pages.
 * Sidebar nav will be added in Phase 8.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar placeholder — Phase 8 */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-card lg:block">
        <div className="flex h-full flex-col p-4">
          <div className="mb-6 px-2 py-3">
            <span className="text-lg font-bold">JobPilot AI</span>
          </div>
          <nav className="space-y-1">
            {["Dashboard", "Jobs", "Applications", "Settings"].map((item) => (
              <div
                key={item}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer"
              >
                {item}
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
