import type { z } from "zod";

export type TriggerGroup = "connection" | "budgets" | "bills" | "transactions" | "digest";
export type TriggerMode = "sweep" | "event";
export type Severity = "info" | "warning" | "critical";

/** Drives the dynamic param inputs in the rule editor. */
export interface ParamField {
  key: string;
  label: string;
  kind: "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  /** Editor populates options from the user's accounts or categories. */
  optionsFrom?: "account" | "category";
  options?: { value: string; label: string }[];
  optional?: boolean;
  help?: string;
}

export interface TriggerVariable {
  name: string;
  description: string;
}

/** One firing produced by a trigger's evaluate(). */
export interface TriggerEvent {
  /** Encodes entity + period; unique per (ruleId, dedupeKey) so re-evaluating
   *  the same true condition doesn't refire. */
  dedupeKey: string;
  vars: Record<string, string>;
}

export interface NotificationEventPayload {
  kind: "plaid-sync" | "plaid-sync-failed" | "csv-import";
  plaidItemId?: string;
  reauthRequired?: boolean;
  failureCount?: number;
  newTransactionIds: string[];
}

export interface TriggerContext {
  userId: string;
  /** Already validated against the trigger's paramsSchema. */
  params: Record<string, unknown>;
  todayISO: string;
  now: Date;
  /** Present only for event-mode invocations. */
  event?: NotificationEventPayload;
}

export interface TriggerDef {
  id: string;
  label: string;
  description: string;
  group: TriggerGroup;
  modes: TriggerMode[];
  severity: Severity;
  paramsSchema: z.ZodTypeAny;
  paramFields: ParamField[];
  variables: TriggerVariable[];
  defaultTemplate: { title: string; body: string };
  /** Placeholder values for "Send test" when the condition isn't currently true. */
  sampleVars: Record<string, string>;
  evaluate(ctx: TriggerContext): Promise<TriggerEvent[]>;
}
