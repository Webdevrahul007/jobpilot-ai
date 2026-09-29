import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function DashboardPage() {
  return (
    <main className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Monitor your automated job applications
        </p>
      </div>

      {/* Stats cards — Phase 8 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            { label: "Total Applied", value: "—", color: "text-blue-600" },
            { label: "Skipped", value: "—", color: "text-yellow-600" },
            { label: "Failed", value: "—", color: "text-red-600" },
            { label: "In Queue", value: "—", color: "text-green-600" },
          ] as const
        ).map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-lg border border-border bg-card p-5 shadow-sm"
          >
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`mt-2 text-3xl font-semibold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        Job application table will appear here — Phase 8
      </div>
    </main>
  );
}
