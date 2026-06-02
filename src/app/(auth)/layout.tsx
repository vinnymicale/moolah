import { Wallet } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-brand">
        <Wallet size={26} />
        <span className="text-lg font-semibold text-text">Household Finance</span>
      </div>
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 text-xs text-muted">Track income, expenses & net worth — together.</p>
    </div>
  );
}
