export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Moolah" width={96} height={96} className="mb-5 h-24 w-24" />
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 text-xs text-muted">Track income, expenses & net worth — together.</p>
    </div>
  );
}
