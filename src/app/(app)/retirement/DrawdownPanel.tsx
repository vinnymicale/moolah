import { formatUSDWhole } from "@/lib/money";
import type { DrawdownReport, DrawdownScenario } from "@/lib/drawdown";

function scenarioCopy(s: DrawdownScenario): string {
  return s.depleted
    ? `Lasts ${s.yearsLasted} years`
    : `Still growing at ${s.yearsLasted} years`;
}

function ScenarioRow({ scenario }: { scenario: DrawdownScenario }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{scenario.label}</span>
      <span className="text-muted">
        {scenarioCopy(scenario)}
        {!scenario.depleted && (
          <span className="ml-1">({formatUSDWhole(scenario.endingBalance)} remaining)</span>
        )}
      </span>
    </div>
  );
}

export function DrawdownPanel({ drawdown }: { drawdown: DrawdownReport }) {
  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-1 text-sm font-semibold">Drawdown scenarios</h2>
      <p className="mb-3 text-xs text-muted">
        Withdrawing {formatUSDWhole(drawdown.annualWithdrawal)}/year, in today&apos;s dollars.
      </p>
      <div className="space-y-2">
        {drawdown.scenarios.map((s) => (
          <ScenarioRow key={s.label} scenario={s} />
        ))}
      </div>

      <div className="mt-4 border-t border-line pt-3">
        <ScenarioRow scenario={drawdown.stressCase} />
        <p className="mt-2 text-xs text-muted">
          This scenario applies the same average return but front-loads poor returns into the
          first five years. Sequence-of-returns risk means the order returns arrive in matters as
          much as the average - a downturn early in retirement forces withdrawals from a smaller
          balance, permanently reducing how long it lasts even if later years recover.
        </p>
      </div>
    </div>
  );
}
