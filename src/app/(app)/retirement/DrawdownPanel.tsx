import { formatUSDWhole } from "@/lib/money";
import { DEFAULT_MAX_YEARS as MAX_HORIZON_YEARS, type DrawdownReport, type DrawdownScenario } from "@/lib/drawdown";

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
      <p className="mb-3 text-xs text-muted">
        This picks up where the projection leaves off: it starts from your projected balance at
        retirement and spends it down. The withdrawal is the share of your target spending the
        portfolio has to cover on its own, after expected Social Security, held flat in today&apos;s
        dollars so inflation is already accounted for.
      </p>
      <div className="space-y-2">
        {drawdown.scenarios.map((s) => (
          <ScenarioRow key={s.label} scenario={s} />
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Each row is a fixed real return held for the whole retirement - your expected return, and
        two percentage points either side of it. The spread is the point: no one knows which of
        these you get, so the honest answer is a range rather than a single year count. &quot;Still
        growing&quot; means the balance outlasted the {MAX_HORIZON_YEARS}-year horizon the model
        runs, with the amount shown left over.
      </p>

      <div className="mt-4 border-t border-line pt-3">
        <ScenarioRow scenario={drawdown.stressCase} />
        <p className="mt-2 text-xs text-muted">
          This scenario applies the same average return but front-loads poor returns into the
          first five years. Sequence-of-returns risk means the order returns arrive in matters as
          much as the average - a downturn early in retirement forces withdrawals from a smaller
          balance, permanently reducing how long it lasts even if later years recover.
        </p>
        <p className="mt-2 text-xs text-muted">
          Compare it against the Expected row: the difference between the two is what bad luck in
          the first five years costs you, holding everything else equal. If that gap is wide enough
          to worry you, the levers are retiring with a larger balance, spending less in the early
          years, or keeping enough cash to avoid selling into a downturn.
        </p>
      </div>
    </div>
  );
}
