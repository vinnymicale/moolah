// Bank-statement CSV import.
//
// Banks export wildly different CSV layouts, so this parser detects columns by
// header name rather than fixed position. It supports the two common shapes:
//
//   1. Separate debit/credit columns  (e.g. Discover):
//        Transaction Date, Transaction Description, Transaction Type, Debit, Credit
//   2. A single signed amount column   (e.g. many credit cards):
//        Date, Description, Amount[, Type]
//
// Output is a list of normalised `ParsedRow`s with an ISO calendar day, a
// positive dollar amount, and an INCOME/EXPENSE type. Everything here is pure
// and synchronous so it can run in the browser and be unit-tested in isolation.

export type ImportType = "INCOME" | "EXPENSE";

export interface ParsedRow {
  /** Calendar day, "YYYY-MM-DD". */
  date: string;
  description: string;
  /** Positive dollar amount. */
  amount: number;
  type: ImportType;
}

export interface SkippedRow {
  line: string;
  reason: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  skipped: SkippedRow[];
  /** Human-readable note on how the columns were interpreted. */
  format: string;
}

// ---------------------------------------------------------------------------
// Low-level CSV tokenising (RFC-4180-ish: quoted fields, "" escapes, embedded
// commas/newlines inside quotes).
// ---------------------------------------------------------------------------

export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  // Normalise newlines.
  const s = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // Flush trailing field/row (file may not end with newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty rows (blank trailing lines).
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

/**
 * Parse a money cell like `$3,085.92 `, `-12.50`, `(45.00)` or `0` to a number.
 * Returns null for blank / non-numeric / exact-zero cells (zero is how the
 * unused side of a debit/credit pair is represented).
 */
export function parseAmountCell(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === "") return null;
  // Accounting-style negatives: (45.00) => -45.00
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  s = s.replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  return negative ? -n : n;
}

/**
 * Parse a date cell to "YYYY-MM-DD". Accepts ISO (YYYY-MM-DD), US M/D/YYYY and
 * M-D-YYYY. Two-digit years map to 2000-2099. Returns null if unrecognised.
 */
export function parseDateCell(raw: string | undefined): string | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return toISO(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    // US convention: month/day/year.
    return toISO(year, Number(slash[1]), Number(slash[2]));
  }

  return null;
}

function toISO(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null; // e.g. Feb 30
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Column detection
// ---------------------------------------------------------------------------

function findCol(headers: string[], ...needles: string[]): number {
  return headers.findIndex((h) => needles.some((n) => h.includes(n)));
}

interface ColumnMap {
  date: number;
  description: number;
  debit: number;
  credit: number;
  amount: number;
  type: number;
  format: string;
}

function detectColumns(headers: string[]): ColumnMap | null {
  const h = headers.map((x) => x.trim().toLowerCase());

  const date = findCol(h, "date");
  const description = findCol(h, "description", "payee", "memo", "name", "details");

  // Prefer exact debit/credit columns, then fall back to deposit/withdrawal.
  const debit = findCol(h, "debit", "withdrawal");
  const credit = findCol(h, "credit", "deposit");
  // A single signed-amount column. Avoid matching "credit"/"debit" again.
  const amount = h.findIndex((x) => x === "amount" || x.endsWith(" amount") || x === "transaction amount");
  const type = findCol(h, "type", "transaction type", "debit/credit", "dr/cr");

  if (date < 0) return null;

  let format: string;
  if (debit >= 0 && credit >= 0) {
    format = "Separate debit & credit columns";
  } else if (amount >= 0) {
    format = "Single signed amount column";
  } else if (debit >= 0 || credit >= 0) {
    format = "Single debit/credit column";
  } else {
    return null;
  }

  return { date, description, debit, credit, amount, type, format };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseBankCsv(text: string): ParseResult {
  const grid = splitCsv(text);
  if (grid.length === 0) {
    return { rows: [], skipped: [], format: "Empty file" };
  }

  const headers = grid[0];
  const cols = detectColumns(headers);
  if (!cols) {
    return {
      rows: [],
      skipped: [{ line: headers.join(","), reason: "Couldn't find a date and amount column in the header." }],
      format: "Unrecognised",
    };
  }

  const rows: ParsedRow[] = [];
  const skipped: SkippedRow[] = [];

  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    const line = cells.join(",");

    const date = parseDateCell(cells[cols.date]);
    if (!date) {
      skipped.push({ line, reason: "Unrecognised or missing date." });
      continue;
    }

    const resolved = resolveAmount(cells, cols);
    if (!resolved) {
      skipped.push({ line, reason: "No usable amount." });
      continue;
    }

    const description = (cols.description >= 0 ? cells[cols.description] : "")?.trim() || "Imported transaction";

    rows.push({ date, description, amount: resolved.amount, type: resolved.type });
  }

  return { rows, skipped, format: cols.format };
}

function resolveAmount(cells: string[], cols: ColumnMap): { amount: number; type: ImportType } | null {
  // Debit/credit pair.
  if (cols.debit >= 0 || cols.credit >= 0) {
    const debit = cols.debit >= 0 ? parseAmountCell(cells[cols.debit]) : null;
    const credit = cols.credit >= 0 ? parseAmountCell(cells[cols.credit]) : null;
    if (credit && credit > 0) return { amount: Math.abs(credit), type: "INCOME" };
    if (debit && debit > 0) return { amount: Math.abs(debit), type: "EXPENSE" };
    // Fall through to a signed amount column if one also exists.
  }

  if (cols.amount >= 0) {
    const n = parseAmountCell(cells[cols.amount]);
    if (n == null) return null;
    const type = directionFromType(cells[cols.type], cols) ?? (n < 0 ? "EXPENSE" : "INCOME");
    return { amount: Math.abs(n), type };
  }

  return null;
}

/** Read an explicit Debit/Credit (or Deposit/Withdrawal) indicator column. */
function directionFromType(raw: string | undefined, cols: ColumnMap): ImportType | null {
  if (cols.type < 0 || raw == null) return null;
  const v = raw.trim().toLowerCase();
  if (/credit|deposit|cr\b|income/.test(v)) return "INCOME";
  if (/debit|withdraw|payment|dr\b|expense/.test(v)) return "EXPENSE";
  return null;
}

// ---------------------------------------------------------------------------
// Category suggestion. Maps a description to one of the seeded default category
// names (see default-categories.ts); the server resolves the name to an actual
// category id for the household.
// ---------------------------------------------------------------------------

const EXPENSE_KEYWORDS: { re: RegExp; category: string }[] = [
  { re: /spotify|youtube|netflix|hulu|disney|prime video|privateinternet|vpn|patreon|icloud|apple\.com\/bill/i, category: "Subscriptions" },
  { re: /ins prem|insurance|allstate|geico|progressive|prog direct|state farm|metlife/i, category: "Insurance" },
  { re: /student ln|dept education|sallie mae|navient|tuition|university|college/i, category: "Education" },
  { re: /mortgage|rent\b|earnest|landlord|leasing|home loan/i, category: "Rent / Mortgage" },
  { re: /loan|autopay|auto loan|aut loan|credit crd|card payment|citizens one/i, category: "Debt Payment" },
  { re: /cox comm|comcast|xfinity|verizon|at&t|t-mobile|spectrum|internet|wireless/i, category: "Internet / Phone" },
  { re: /electric|ppl |util|water|gas company|sunrun|national grid|power/i, category: "Utilities" },
  { re: /uber eats|doordash|grubhub|restaurant|pizza|cafe|coffee|starbucks|dunkin|mcdonald|chipotle/i, category: "Dining Out" },
  { re: /grocery|supermarket|costco|walmart|target|trader joe|whole foods|aldi|stop & shop/i, category: "Groceries" },
  { re: /shell|exxon|mobil|chevron|bp |sunoco|gas station|fuel/i, category: "Gas / Fuel" },
  { re: /uber|lyft|transit|parking|toll|mbta/i, category: "Transportation" },
  { re: /irs |usataxpymt|tax pymt|tax payment|franchise tax/i, category: "Taxes" },
  { re: /atm|fee\b|service charge|overdraft|nsf/i, category: "Fees" },
  { re: /amazon|amzn|ebay|best buy|store purchase|google store/i, category: "Shopping" },
];

const INCOME_KEYWORDS: { re: RegExp; category: string }[] = [
  { re: /payroll|salary|direct dep|paycheck|wages|adp /i, category: "Salary" },
  { re: /refund|rfd|tax refund|tax division|taxrfd|rireturn/i, category: "Refund" },
  { re: /interest/i, category: "Interest" },
  { re: /dividend|capital gain|brokerage/i, category: "Investment Income" },
  { re: /bonus/i, category: "Bonus" },
];

/** Best-guess default-category name for a description, or null. */
export function guessCategoryName(description: string, type: ImportType): string | null {
  const list = type === "INCOME" ? INCOME_KEYWORDS : EXPENSE_KEYWORDS;
  for (const { re, category } of list) {
    if (re.test(description)) return category;
  }
  return null;
}
