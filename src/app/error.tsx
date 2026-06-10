"use client";

import Link from "next/link";
import { useEffect } from "react";

// Route-level error boundary. Catches render/data errors thrown below the root
// layout and offers a retry without a full page reload.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-bold text-text">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted">
        An unexpected error occurred. You can try again, or head back to the dashboard.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted">Reference: {error.digest}</p>
      )}
      <div className="mt-2 flex gap-2">
        <button onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn btn-ghost">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
