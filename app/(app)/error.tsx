"use client";

import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useEffect } from "react";
import { AppHeader } from "@/components/app-shell/app-header";
import { Button } from "@/components/ui/button";

/**
 * Catches errors from any page in the sidebar shell, which stays on screen.
 * Server errors arrive with a generic message in production, so only the
 * digest (matching the server log) is shown.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <AppHeader segments={[{ label: "Something went wrong" }]} />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-6 text-destructive" />
        </span>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="max-w-md text-muted-foreground">
            This page could not be loaded. Try again, or go back to your
            dashboard.
          </p>
          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              Reference: <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()}>
            <RotateCw className="size-4" />
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
