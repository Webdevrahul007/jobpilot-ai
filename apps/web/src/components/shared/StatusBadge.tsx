import { Badge } from "@/components/ui/badge";
import type { ApplicationStatus } from "@/types/api";

const STATUS_CONFIG: Record<
  ApplicationStatus,
  { label: string; variant: "success" | "info" | "warning" | "destructive" | "secondary" | "outline" }
> = {
  APPLIED:     { label: "Applied",     variant: "success" },
  IN_PROGRESS: { label: "In Progress", variant: "info" },
  PENDING:     { label: "Pending",     variant: "warning" },
  SKIPPED:     { label: "Skipped",     variant: "secondary" },
  FAILED:      { label: "Failed",      variant: "destructive" },
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
