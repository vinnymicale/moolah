export function StrategyButton({ active, onClick, icon, label, hint }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; hint: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-start rounded-md px-3 py-1.5 text-left transition-colors ${active ? "bg-surface shadow-sm" : "text-muted hover:text-text"}`}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">{icon} {label}</span>
      <span className="text-[10px] text-muted">{hint}</span>
    </button>
  );
}
