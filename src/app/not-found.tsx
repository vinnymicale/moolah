import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm font-semibold text-brand">404</p>
      <h1 className="text-2xl font-bold text-text">Page not found</h1>
      <p className="max-w-sm text-sm text-muted">
        That page doesn&apos;t exist or may have moved.
      </p>
      <Link href="/" className="btn btn-primary mt-2">
        Back to dashboard
      </Link>
    </div>
  );
}
