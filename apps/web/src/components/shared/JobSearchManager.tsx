"use client";

import { useState } from "react";
import {
  Plus, Play, Trash2, MapPin, Search,
  Wifi, WifiOff, Calendar, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  useSearches, useCreateSearch, useDeleteSearch,
  useRunSearch, useRunDetection, useRunApply,
} from "@/hooks/useApi";
import { DEV_USER_ID } from "@/lib/api";
import type { JobSearch } from "@/types/api";

interface JobSearchManagerProps {
  userId?: string;
  onSearchSelect?: (searchId: string) => void;
  selectedSearchId?: string;
}

// ── Create Search Dialog ──────────────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  userId: string;
}

function CreateSearchDialog({ open, onClose, userId }: CreateDialogProps) {
  const [form, setForm] = useState({
    name: "",
    keywords: "",
    location: "",
    remote: false,
  });
  const createSearch = useCreateSearch();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.keywords.trim()) return;

    await createSearch.mutateAsync({
      userId,
      name: form.name.trim(),
      keywords: form.keywords.trim(),
      ...(form.location.trim() && { location: form.location.trim() }),
      remote: form.remote,
    });

    setForm({ name: "", keywords: "", location: "", remote: false });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New Job Search</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Search Name *</label>
            <Input
              placeholder="e.g. Senior React Developer"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Keywords *</label>
            <Input
              placeholder="e.g. React, Node.js, TypeScript"
              value={form.keywords}
              onChange={(e) => setForm((f) => ({ ...f, keywords: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Location</label>
            <Input
              placeholder="e.g. Bangalore, India (leave blank for any)"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.remote}
              onChange={(e) => setForm((f) => ({ ...f, remote: e.target.checked }))}
              className="rounded"
            />
            Remote jobs only
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createSearch.isPending}>
              {createSearch.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Search
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Search Card ───────────────────────────────────────────────────────────────

interface SearchCardProps {
  search: JobSearch;
  userId: string;
  isSelected: boolean;
  onSelect: () => void;
}

function SearchCard({ search, userId, isSelected, onSelect }: SearchCardProps) {
  const deleteSearch = useDeleteSearch();
  const runSearch = useRunSearch();
  const runDetection = useRunDetection();
  const runApply = useRunApply();
  const [runningAction, setRunningAction] = useState<string | null>(null);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${search.name}"? This removes all collected jobs too.`)) return;
    await deleteSearch.mutateAsync({ searchId: search.id, userId });
  };

  const handleAction = async (
    action: string,
    fn: () => Promise<unknown>
  ) => {
    setRunningAction(action);
    try {
      await fn();
    } finally {
      setRunningAction(null);
    }
  };

  const isRunning = runningAction !== null;

  return (
    <div
      onClick={onSelect}
      className={`relative cursor-pointer rounded-lg border p-4 transition-all hover:shadow-md ${
        isSelected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border bg-card hover:border-primary/40"
      }`}
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{search.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Search className="h-3 w-3" />
              {search.keywords}
            </span>
            {search.location && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {search.location}
              </span>
            )}
            {search.remote && (
              <Badge variant="info" className="text-xs">
                <Wifi className="mr-1 h-3 w-3" />
                Remote
              </Badge>
            )}
          </div>
        </div>
        <Badge variant={search.isActive ? "success" : "secondary"} className="shrink-0">
          {search.isActive ? "Active" : "Paused"}
        </Badge>
      </div>

      {/* Last run */}
      {search.lastRunAt && (
        <p className="mb-3 flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          Last run: {new Date(search.lastRunAt).toLocaleDateString()}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isRunning}
          onClick={(e) => {
            e.stopPropagation();
            handleAction("search", () => runSearch.mutateAsync({ searchId: search.id, userId, maxPages: 3 }));
          }}
        >
          {runningAction === "search" ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Search className="mr-1 h-3 w-3" />
          )}
          Collect Jobs
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={isRunning}
          onClick={(e) => {
            e.stopPropagation();
            handleAction("detect", () => runDetection.mutateAsync({ searchId: search.id, userId }));
          }}
        >
          {runningAction === "detect" ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <WifiOff className="mr-1 h-3 w-3" />
          )}
          Detect Easy Apply
        </Button>

        <Button
          size="sm"
          disabled={isRunning}
          onClick={(e) => {
            e.stopPropagation();
            handleAction("apply", () =>
              runApply.mutateAsync({ userId, jobSearchId: search.id, limit: 5 })
            );
          }}
        >
          {runningAction === "apply" ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Play className="mr-1 h-3 w-3" />
          )}
          Apply
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive hover:text-destructive"
          disabled={isRunning}
          onClick={handleDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {isRunning && (
        <div className="mt-2 rounded bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          Running {runningAction}… this may take a few minutes
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function JobSearchManager({
  userId = DEV_USER_ID,
  onSearchSelect,
  selectedSearchId,
}: JobSearchManagerProps) {
  const [showCreate, setShowCreate] = useState(false);
  const { data: searches, isLoading } = useSearches(userId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Job Searches</CardTitle>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New Search
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))}
          </div>
        )}

        {!isLoading && (!searches || searches.length === 0) && (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            No searches yet. Create one to start collecting jobs.
          </div>
        )}

        {searches?.map((s) => (
          <SearchCard
            key={s.id}
            search={s}
            userId={userId}
            isSelected={selectedSearchId === s.id}
            onSelect={() => onSearchSelect?.(s.id)}
          />
        ))}
      </CardContent>

      <CreateSearchDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        userId={userId}
      />
    </Card>
  );
}
