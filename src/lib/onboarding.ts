// Derives the first-run setup checklist from what the user has actually done.
// Stateless, like milestones: each step has a stable id so the UI can remember
// (in localStorage) that the whole checklist was dismissed, and the steps
// themselves tick off on their own as real data shows up.

export interface OnboardingStep {
  id: "account" | "transactions" | "budget" | "recurring";
  title: string;
  detail: string;
  /** Where the step's button sends the user. */
  href: string;
  cta: string;
  done: boolean;
}

export interface OnboardingInput {
  accountCount: number;
  transactionCount: number;
  budgetCount: number;
  recurringCount: number;
}

/**
 * The four things that turn an empty install into a working one, in the order
 * they depend on each other: an account to hold transactions, transactions to
 * budget against, a budget, then recurring bills so the calendar can project.
 */
export function computeOnboardingSteps(input: OnboardingInput): OnboardingStep[] {
  return [
    {
      id: "account",
      title: "Add an account",
      detail: "Link a bank through Plaid, or add one manually to track by hand.",
      href: "/accounts",
      cta: "Add account",
      done: input.accountCount > 0,
    },
    {
      id: "transactions",
      title: "Bring in transactions",
      detail: "Sync a linked account, import a CSV, or enter one yourself.",
      href: "/transactions",
      cta: "Add transactions",
      done: input.transactionCount > 0,
    },
    {
      id: "budget",
      title: "Set a budget",
      detail: "Pick a monthly limit for a category you care about.",
      href: "/budgets",
      cta: "Set a budget",
      done: input.budgetCount > 0,
    },
    {
      id: "recurring",
      title: "Add a recurring bill",
      detail: "Rent, subscriptions, payday - these drive the calendar's forecast.",
      href: "/recurring",
      cta: "Add a bill",
      done: input.recurringCount > 0,
    },
  ];
}

/**
 * Whether the checklist is worth showing at all. A user who has finished every
 * step never sees it, so a long-time user who clears localStorage doesn't get
 * a setup prompt for an account they set up two years ago.
 */
export function onboardingComplete(steps: OnboardingStep[]): boolean {
  return steps.every((s) => s.done);
}
