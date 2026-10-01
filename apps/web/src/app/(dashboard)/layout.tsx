import type { ReactNode } from "react";
import { Sidebar } from "@/components/shared/Sidebar";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar — hidden on mobile, shown on lg+ */}
      <div className="hidden w-60 shrink-0 lg:block">
        <Sidebar />
      </div>

      {/* Main scrollable area */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
