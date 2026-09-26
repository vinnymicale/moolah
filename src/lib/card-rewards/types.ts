import { z } from "zod";
import { REWARD_CATEGORY_KEYS } from "./categories";

export const ROTATING_CAP_KEY = "ROTATING";

const rate = z.number().min(0, "Rate can't be negative").max(100, "Rate can't exceed 100");

export const capPeriodSchema = z.enum(["MONTH", "QUARTER", "YEAR"]);
export const rewardCurrencySchema = z.enum(["CASH", "POINTS", "MILES"]);
export const rewardCategorySchema = z.enum(REWARD_CATEGORY_KEYS);

export const rewardCapSchema = z.object({
  amount: z.number().positive("Cap must be greater than zero"),
  period: capPeriodSchema,
});

export const rewardRuleSchema = z.object({
  category: rewardCategorySchema,
  rate,
  cap: rewardCapSchema.optional(),
});

export const rewardRulesSchema = z
  .array(rewardRuleSchema)
  .refine((rules) => new Set(rules.map((r) => r.category)).size === rules.length, {
    message: "Each category can only have one rate",
  });

export const rotatingQuarterSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  categories: z.array(rewardCategorySchema).min(1, "Pick at least one category"),
});

export const rotatingProgramSchema = z.object({
  rate,
  capAmount: z.number().positive("Cap must be greater than zero"),
  quarters: z
    .array(rotatingQuarterSchema)
    .refine((qs) => new Set(qs.map((q) => `${q.year}-${q.quarter}`)).size === qs.length, {
      message: "Each quarter can only be listed once",
    }),
});

export const rewardProfileInputSchema = z.object({
  currency: rewardCurrencySchema,
  programName: z.string().trim().max(80).nullable(),
  centsPerPoint: z.number().gt(0, "Cents per point must be above zero").max(10),
  baseRate: rate,
  rules: rewardRulesSchema,
  rotating: rotatingProgramSchema.nullable(),
});

export type CapPeriod = z.infer<typeof capPeriodSchema>;
export type RewardCurrency = z.infer<typeof rewardCurrencySchema>;
export type RewardCap = z.infer<typeof rewardCapSchema>;
export type RewardRule = z.infer<typeof rewardRuleSchema>;
export type RotatingQuarter = z.infer<typeof rotatingQuarterSchema>;
export type RotatingProgram = z.infer<typeof rotatingProgramSchema>;
export type RewardProfileInput = z.infer<typeof rewardProfileInputSchema>;

export function parseRules(json: unknown): RewardRule[] {
  const r = rewardRulesSchema.safeParse(json);
  return r.success ? r.data : [];
}

export function parseRotating(json: unknown): RotatingProgram | null {
  if (json == null) return null;
  const r = rotatingProgramSchema.safeParse(json);
  return r.success ? r.data : null;
}
