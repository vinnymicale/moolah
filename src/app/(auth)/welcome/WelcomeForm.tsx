"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Home, Users } from "lucide-react";
import { createHouseholdAction, joinHouseholdAction } from "@/actions/household";

export function WelcomeForm({ defaultName }: { defaultName: string }) {
  const router = useRouter();
  const { update } = useSession();
  const [tab, setTab] = useState<"create" | "join">("create");
  const [name, setName] = useState(defaultName);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onDone = async () => {
    await update(); // refresh the JWT so householdId is populated
    router.push("/");
    router.refresh();
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const res = tab === "create" ? await createHouseholdAction(name) : await joinHouseholdAction(code);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await onDone();
    });

  return (
    <div className="card p-6">
      <h1 className="mb-1 text-xl font-semibold">Set up your household</h1>
      <p className="mb-5 text-sm text-muted">
        Everyone in a household shares the same accounts, calendar and budgets.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-2 rounded-lg bg-surface2 p-1">
        <button
          onClick={() => setTab("create")}
          className={`btn text-sm ${tab === "create" ? "bg-surface shadow-sm" : "text-muted"}`}
        >
          <Home size={15} /> Create
        </button>
        <button
          onClick={() => setTab("join")}
          className={`btn text-sm ${tab === "join" ? "bg-surface shadow-sm" : "text-muted"}`}
        >
          <Users size={15} /> Join
        </button>
      </div>

      {tab === "create" ? (
        <div>
          <label className="label">Household name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Smith Household" />
          <p className="mt-2 text-xs text-muted">We&apos;ll set you up with default categories to start.</p>
        </div>
      ) : (
        <div>
          <label className="label">Invite code</label>
          <input
            className="input font-mono uppercase tracking-wider"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD-2345"
          />
          <p className="mt-2 text-xs text-muted">Ask your partner for the code shown in their Settings page.</p>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-expense">{error}</p>}

      <button onClick={submit} disabled={pending} className="btn-primary mt-5 w-full py-2.5">
        {pending ? "Working…" : tab === "create" ? "Create household" : "Join household"}
      </button>
    </div>
  );
}
