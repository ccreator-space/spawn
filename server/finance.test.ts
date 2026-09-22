import test from "node:test";
import assert from "node:assert/strict";
import { publicationPayment, summarizeMoney } from "./finance.js";

test("only published unpaid work becomes a receivable", () => {
  const publications = [
    { id: "published", fee_minor: 20_000, currency: "USD", status: "published" },
    { id: "planned", fee_minor: 25_000, currency: "USD", status: "planned" },
  ];
  const transactions = [{ publication_id: "published", kind: "income", amount_minor: 1_200_000, currency: "TRY", applied_minor: 20_000, applied_currency: "USD" }];
  const totals = summarizeMoney(publications, transactions);
  assert.equal(totals.USD.contracted, 45_000);
  assert.equal(totals.TRY.received, 1_200_000);
  assert.equal(totals.USD.outstanding, 0);
  assert.deepEqual(publicationPayment(publications[0]!, transactions), { paid_minor: 20_000, outstanding_minor: 0, payment_status: "paid" });
  assert.equal(publicationPayment(publications[1]!, transactions).payment_status, "not_due");
});

