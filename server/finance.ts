export type MoneyTotals = Record<"TRY" | "USD", { contracted: number; received: number; credit: number; spent: number; outstanding: number }>;

type PublicationMoney = { id?: string; fee_minor: number; currency: string; status: string };
type TransactionMoney = { publication_id?: string | null; kind: string; amount_minor: number; currency: string; applied_minor?: number | null; applied_currency?: string | null };

export function publicationPayment(publication: PublicationMoney, transactions: TransactionMoney[]) {
  const paidMinor = transactions.reduce((sum, transaction) => {
    if (transaction.publication_id !== publication.id || (transaction.kind !== "income" && transaction.kind !== "credit")) return sum;
    if (transaction.applied_currency === publication.currency && typeof transaction.applied_minor === "number") return sum + transaction.applied_minor;
    if (!transaction.applied_currency && transaction.currency === publication.currency) return sum + transaction.amount_minor;
    return sum;
  }, 0);
  const outstandingMinor = Math.max(0, publication.fee_minor - paidMinor);
  const status = publication.fee_minor === 0 ? "no_fee"
    : paidMinor >= publication.fee_minor ? "paid"
      : paidMinor > 0 ? "partial"
        : publication.status === "published" ? "waiting" : "not_due";
  return { paid_minor: paidMinor, outstanding_minor: outstandingMinor, payment_status: status };
}

export function summarizeMoney(
  publications: PublicationMoney[],
  transactions: TransactionMoney[],
): MoneyTotals {
  const result: MoneyTotals = {
    TRY: { contracted: 0, received: 0, credit: 0, spent: 0, outstanding: 0 },
    USD: { contracted: 0, received: 0, credit: 0, spent: 0, outstanding: 0 },
  };
  for (const item of publications) {
    if (item.status !== "cancelled" && (item.currency === "TRY" || item.currency === "USD")) {
      result[item.currency].contracted += item.fee_minor;
      if (item.status === "published") result[item.currency].outstanding += publicationPayment(item, transactions).outstanding_minor;
    }
  }
  for (const item of transactions) {
    if (item.currency !== "TRY" && item.currency !== "USD") continue;
    if (item.kind === "income") result[item.currency].received += item.amount_minor;
    if (item.kind === "credit") result[item.currency].credit += item.amount_minor;
    if (item.kind === "expense") result[item.currency].spent += item.amount_minor;
  }
  for (const transaction of transactions) {
    if (transaction.publication_id || (transaction.kind !== "income" && transaction.kind !== "credit")) continue;
    if (transaction.currency === "TRY" || transaction.currency === "USD") {
      result[transaction.currency].outstanding = Math.max(0, result[transaction.currency].outstanding - transaction.amount_minor);
    }
  }
  return result;
}
