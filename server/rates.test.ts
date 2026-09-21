import test from "node:test";
import assert from "node:assert/strict";
import { parseDovizRate } from "./rates.js";

test("Doviz.dev TRY response yields USD/TRY and source date", () => {
  const rate = parseDovizRate({
    USDTRY: 48.7723,
    _meta: { source: "tcmb.gov.tr", updated_at: "2026-09-18T12:30:00.000Z" },
  });
  assert.deepEqual(rate, { date: "2026-09-18", usdTry: 48.7723, source: "Doviz.dev · TCMB" });
  assert.throws(() => parseDovizRate({ USDTRY: 0, _meta: { updated_at: "invalid" } }), /Invalid/);
});
