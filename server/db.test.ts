import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.js";

test("reopening an existing database adds sponsors without changing saved records", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sponsor-upgrade-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "sponsor.db");
  const first = openDb(file);
  first.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run("owner", "owner@example.com", "saved-hash");
  first.prepare("UPDATE sponsors SET notes = ? WHERE id = ?").run("Keep this private note", "hostinger");
  first.prepare("INSERT INTO transactions (id, sponsor_id, kind, amount_minor, currency, occurred_on, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("receipt", "hostinger", "income", 12345, "USD", "2026-09-19", "Saved payment");
  first.close();

  const second = openDb(file, { createIfMissing: false });
  assert.equal((second.prepare("SELECT COUNT(*) AS n FROM sponsors").get() as { n: number }).n, 9);
  assert.deepEqual(second.prepare("SELECT email, password_hash FROM users WHERE id = 'owner'").get(), { email: "owner@example.com", password_hash: "saved-hash" });
  assert.equal((second.prepare("SELECT notes FROM sponsors WHERE id = 'hostinger'").get() as { notes: string }).notes, "Keep this private note");
  assert.equal((second.prepare("SELECT amount_minor FROM transactions WHERE id = 'receipt'").get() as { amount_minor: number }).amount_minor, 12345);
  assert.equal(second.pragma("integrity_check", { simple: true }), "ok");
  second.close();
  assert.throws(() => openDb(join(dir, "wrong-volume.db"), { createIfMissing: false }), /Database is missing/);
});
