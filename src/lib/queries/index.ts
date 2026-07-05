// Read layer. Returns plain, serializable DTOs (numbers, strings, ISO dates) so
// results can be passed straight into client components - Prisma Decimal values
// are never sent across that boundary.
//
// Split by domain; this barrel keeps "@/lib/queries" as the single import path.

export * from "./accounts";
export * from "./categories";
export * from "./transactions";
export * from "./recurring";
export * from "./rules";
export * from "./budgets";
export * from "./plaid";
export * from "./goals";
export * from "./insights";
