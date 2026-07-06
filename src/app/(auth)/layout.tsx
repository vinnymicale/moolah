export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="" width={72} height={72} className="mb-4 h-18 w-18" />
      <h1 className="mb-6 font-display text-3xl font-semibold tracking-tight">Moolah</h1>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 text-xs text-muted">Track income, expenses & net worth - on your own terms.</p>
    </div>
  );
}
