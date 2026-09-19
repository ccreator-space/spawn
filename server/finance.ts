export type MoneyTotals = Record<"TRY" | "USD", { contracted: number; received: number; spent: number; outstanding: number }>;

export function summarizeMoney(
  publications: Array<{ fee_minor: number; currency: string; status: string }>,
  transactions: Array<{ kind: string; amount_minor: number; currency: string }>,
): MoneyTotals {
  const result: MoneyTotals = {
    TRY: { contracted: 0, received: 0, spent: 0, outstanding: 0 },
    USD: { contracted: 0, received: 0, spent: 0, outstanding: 0 },
  };
  for (const item of publications) {
    if (item.status !== "cancelled" && (item.currency === "TRY" || item.currency === "USD")) {
      result[item.currency].contracted += item.fee_minor;
    }
  }
  for (const item of transactions) {
    if (item.currency !== "TRY" && item.currency !== "USD") continue;
    if (item.kind === "income") result[item.currency].received += item.amount_minor;
    if (item.kind === "expense") result[item.currency].spent += item.amount_minor;
  }
  for (const currency of ["TRY", "USD"] as const) {
    result[currency].outstanding = Math.max(0, result[currency].contracted - result[currency].received);
  }
  return result;
}
