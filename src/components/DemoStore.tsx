"use client";

/**
 * Demo mode in-memory store.
 *
 * Holds all mutable app state for the demo deployment. Mutations update state
 * locally only — nothing is persisted to a database. Any visitor always starts
 * from the same clean dataset, so the live demo stays consistent.
 *
 * Usage:
 *   - Wrap the app in <DemoStoreProvider initialData={...} />
 *   - In any client component: const demo = useDemoStore()
 *   - Call demo.addTransaction(...), demo.updateBudget(...), etc.
 */

import {
  createContext, useContext, useState, useCallback, useRef,
  type ReactNode,
} from "react";
import type {
  AccountDTO, CategoryDTO, TransactionDTO, RecurringDTO,
  BudgetLineDTO, SavingsGoalDTO, SnapshotDTO,
} from "@/lib/queries";
import type { RecurringSuggestion } from "@/lib/recurring-suggestions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DemoState {
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  transactions: TransactionDTO[];
  recurring: RecurringDTO[];
  budgets: BudgetLineDTO[];
  goals: SavingsGoalDTO[];
  snapshots: SnapshotDTO[];
  suggestions: RecurringSuggestion[];
}

export interface DemoMutations {
  // Transactions
  addTransaction: (t: TransactionDTO) => void;
  updateTransaction: (id: string, patch: Partial<TransactionDTO>) => void;
  deleteTransaction: (id: string) => void;
  bulkDeleteTransactions: (ids: string[]) => void;
  bulkSetCategory: (ids: string[], categoryId: string | null) => void;
  bulkSetAccount: (ids: string[], accountId: string | null) => void;
  bulkSetCleared: (ids: string[], cleared: boolean) => void;
  // Accounts
  addAccount: (a: AccountDTO) => void;
  updateAccount: (id: string, patch: Partial<AccountDTO>) => void;
  deleteAccount: (id: string) => void;
  // Categories
  addCategory: (c: CategoryDTO) => void;
  updateCategory: (id: string, patch: Partial<CategoryDTO>) => void;
  deleteCategory: (id: string) => void;
  // Recurring rules
  addRecurring: (r: RecurringDTO) => void;
  updateRecurring: (id: string, patch: Partial<RecurringDTO>) => void;
  deleteRecurring: (id: string) => void;
  dismissSuggestion: (key: string) => void;
  // Budgets
  setBudget: (categoryId: string, limit: number) => void;
  // Goals
  addGoal: (g: SavingsGoalDTO) => void;
  updateGoal: (id: string, patch: Partial<SavingsGoalDTO>) => void;
  deleteGoal: (id: string) => void;
  contributeToGoal: (id: string, amount: number) => void;
}

export type DemoStore = DemoState & DemoMutations;

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const DemoContext = createContext<DemoStore | null>(null);

export function useDemoStore(): DemoStore {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemoStore must be used inside DemoStoreProvider");
  return ctx;
}

/** Safe version — returns null outside demo mode. */
export function useDemoStoreOrNull(): DemoStore | null {
  return useContext(DemoContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function DemoStoreProvider({
  children,
  initialData,
}: {
  children: ReactNode;
  initialData: DemoState;
}) {
  const nextId = useRef(1000);
  const uid = () => `demo-${nextId.current++}`;

  const [accounts, setAccounts] = useState<AccountDTO[]>(initialData.accounts);
  const [categories, setCategories] = useState<CategoryDTO[]>(initialData.categories);
  const [transactions, setTransactions] = useState<TransactionDTO[]>(initialData.transactions);
  const [recurring, setRecurring] = useState<RecurringDTO[]>(initialData.recurring);
  const [budgets, setBudgets] = useState<BudgetLineDTO[]>(initialData.budgets);
  const [goals, setGoals] = useState<SavingsGoalDTO[]>(initialData.goals);
  const [snapshots] = useState<SnapshotDTO[]>(initialData.snapshots);
  const [suggestions, setSuggestions] = useState<RecurringSuggestion[]>(initialData.suggestions);

  // Transactions
  const addTransaction = useCallback((t: TransactionDTO) => {
    const withId = t.id ? t : { ...t, id: uid() };
    setTransactions((prev) => [withId, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
  }, []);

  const updateTransaction = useCallback((id: string, patch: Partial<TransactionDTO>) => {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const bulkDeleteTransactions = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setTransactions((prev) => prev.filter((t) => !set.has(t.id)));
  }, []);

  const bulkSetCategory = useCallback((ids: string[], categoryId: string | null) => {
    const set = new Set(ids);
    setTransactions((prev) => prev.map((t) => set.has(t.id) ? { ...t, categoryId } : t));
  }, []);

  const bulkSetAccount = useCallback((ids: string[], accountId: string | null) => {
    const set = new Set(ids);
    setTransactions((prev) => prev.map((t) => set.has(t.id) ? { ...t, accountId } : t));
  }, []);

  const bulkSetCleared = useCallback((ids: string[], cleared: boolean) => {
    const set = new Set(ids);
    setTransactions((prev) => prev.map((t) => set.has(t.id) ? { ...t, cleared } : t));
  }, []);

  // Accounts
  const addAccount = useCallback((a: AccountDTO) => {
    const withId = a.id ? a : { ...a, id: uid() };
    setAccounts((prev) => [...prev, withId]);
  }, []);

  const updateAccount = useCallback((id: string, patch: Partial<AccountDTO>) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }, []);

  const deleteAccount = useCallback((id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Categories
  const addCategory = useCallback((c: CategoryDTO) => {
    const withId = c.id ? c : { ...c, id: uid() };
    setCategories((prev) => [...prev, withId]);
  }, []);

  const updateCategory = useCallback((id: string, patch: Partial<CategoryDTO>) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const deleteCategory = useCallback((id: string) => {
    setCategories((prev) => prev.filter((c) => c.id !== id));
  }, []);

  // Recurring
  const addRecurring = useCallback((r: RecurringDTO) => {
    const withId = r.id ? r : { ...r, id: uid() };
    setRecurring((prev) => [...prev, withId]);
  }, []);

  const updateRecurring = useCallback((id: string, patch: Partial<RecurringDTO>) => {
    setRecurring((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const deleteRecurring = useCallback((id: string) => {
    setRecurring((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const dismissSuggestion = useCallback((key: string) => {
    setSuggestions((prev) => prev.filter((s) => s.key !== key));
  }, []);

  // Budgets
  const setBudget = useCallback((categoryId: string, limit: number) => {
    setBudgets((prev) => {
      const exists = prev.find((b) => b.categoryId === categoryId);
      if (exists) {
        if (limit <= 0) return prev.filter((b) => b.categoryId !== categoryId);
        return prev.map((b) => b.categoryId === categoryId ? { ...b, limit } : b);
      }
      const cat = categories.find((c) => c.id === categoryId);
      if (!cat) return prev;
      return [...prev, { categoryId, name: cat.name, color: cat.color, icon: cat.icon, limit, actual: 0 }];
    });
  }, [categories]);

  // Goals
  const addGoal = useCallback((g: SavingsGoalDTO) => {
    const withId = g.id ? g : { ...g, id: uid() };
    setGoals((prev) => [...prev, withId]);
  }, []);

  const updateGoal = useCallback((id: string, patch: Partial<SavingsGoalDTO>) => {
    setGoals((prev) => prev.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  }, []);

  const deleteGoal = useCallback((id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const contributeToGoal = useCallback((id: string, amount: number) => {
    setGoals((prev) =>
      prev.map((g) => g.id === id ? { ...g, currentAmount: g.currentAmount + amount } : g)
    );
  }, []);

  const store: DemoStore = {
    accounts, categories, transactions, recurring, budgets, goals, snapshots, suggestions,
    addTransaction, updateTransaction, deleteTransaction,
    bulkDeleteTransactions, bulkSetCategory, bulkSetAccount, bulkSetCleared,
    addAccount, updateAccount, deleteAccount,
    addCategory, updateCategory, deleteCategory,
    addRecurring, updateRecurring, deleteRecurring, dismissSuggestion,
    setBudget,
    addGoal, updateGoal, deleteGoal, contributeToGoal,
  };

  return <DemoContext.Provider value={store}>{children}</DemoContext.Provider>;
}
