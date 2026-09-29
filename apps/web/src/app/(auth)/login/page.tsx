import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight">JobPilot AI</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to manage your job applications
          </p>
        </div>

        {/* Login form will be wired up in the auth phase */}
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Login form — Phase 2
        </div>
      </div>
    </main>
  );
}
