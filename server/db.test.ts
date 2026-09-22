import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "./db.js";
import Database from "better-sqlite3";

test("reopening an existing database keeps saved records", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sponsor-upgrade-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "sponsor.db");
  const first = openDb(file);
  first.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run("owner", "owner@example.com", "saved-hash");
  first.prepare("INSERT INTO sponsors (id, slug, name, notes) VALUES (?, ?, ?, ?)").run("hostinger", "hostinger", "Hostinger", "Keep this private note");
  first.prepare("INSERT INTO transactions (id, sponsor_id, kind, amount_minor, currency, occurred_on, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("receipt", "hostinger", "income", 12345, "USD", "2026-09-19", "Saved payment");
  first.close();

  const second = openDb(file, { createIfMissing: false });
  assert.equal((second.prepare("SELECT COUNT(*) AS n FROM sponsors").get() as { n: number }).n, 1);
  assert.deepEqual(second.prepare("SELECT email, password_hash FROM users WHERE id = 'owner'").get(), { email: "owner@example.com", password_hash: "saved-hash" });
  assert.equal((second.prepare("SELECT notes FROM sponsors WHERE id = 'hostinger'").get() as { notes: string }).notes, "Keep this private note");
  assert.equal((second.prepare("SELECT amount_minor FROM transactions WHERE id = 'receipt'").get() as { amount_minor: number }).amount_minor, 12345);
  assert.equal(second.pragma("integrity_check", { simple: true }), "ok");
  second.close();
  assert.throws(() => openDb(join(dir, "wrong-volume.db"), { createIfMissing: false }), /Database is missing/);
});

test("schema 1 upgrades transactions without losing existing rows", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sponsor-schema-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "sponsor.db");
  const legacy = new Database(file);
  legacy.exec(`
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, sponsor_id TEXT, publication_id TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
      amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
      occurred_on TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO transactions (id, kind, amount_minor, currency, occurred_on, note)
      VALUES ('old-income', 'income', 9900, 'TRY', '2026-09-20', 'Korunacak kayıt');
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const upgraded = openDb(file, { createIfMissing: false });
  assert.equal(upgraded.pragma("user_version", { simple: true }), 4);
  assert.equal((upgraded.prepare("SELECT amount_minor FROM transactions WHERE id = 'old-income'").get() as { amount_minor: number }).amount_minor, 9900);
  upgraded.prepare("INSERT INTO transactions (id, kind, amount_minor, currency, occurred_on) VALUES (?, ?, ?, ?, ?)")
    .run("new-credit", "credit", 700000, "TRY", "2026-09-21");
  assert.equal((upgraded.prepare("SELECT kind FROM transactions WHERE id = 'new-credit'").get() as { kind: string }).kind, "credit");
  assert.equal((upgraded.prepare("SELECT COUNT(*) AS n FROM schedule_slots").get() as { n: number }).n, 25);
  assert.equal((upgraded.prepare("SELECT onboarding_completed FROM workspace_settings WHERE id = 1").get() as { onboarding_completed: number }).onboarding_completed, 1);
  assert.equal(upgraded.pragma("integrity_check", { simple: true }), "ok");
  upgraded.close();
});

test("schema 3 adds safe removal fields without losing records", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "sponsor-soft-delete-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "sponsor.db");
  const legacy = new Database(file);
  legacy.exec(`
    CREATE TABLE sponsors (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      website_url TEXT, logo_url TEXT, notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE publications (
      id TEXT PRIMARY KEY, sponsor_id TEXT REFERENCES sponsors(id),
      platform TEXT NOT NULL, format TEXT NOT NULL, slot_id TEXT,
      title TEXT NOT NULL, planned_date TEXT NOT NULL, published_date TEXT,
      status TEXT NOT NULL CHECK(status IN ('planned','published','cancelled')),
      url TEXT, fee_minor INTEGER NOT NULL DEFAULT 0 CHECK(fee_minor >= 0),
      currency TEXT NOT NULL CHECK(currency IN ('TRY','USD')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX idx_publications_slot ON publications(planned_date, slot_id)
      WHERE slot_id IS NOT NULL AND status != 'cancelled';
    INSERT INTO sponsors (id, slug, name) VALUES ('brand', 'brand', 'Korunacak Sponsor');
    INSERT INTO publications (id, sponsor_id, platform, format, slot_id, title, planned_date, status, fee_minor, currency)
      VALUES ('video', 'brand', 'YouTube', 'long', 'slot', 'Korunacak Video', '2026-09-21', 'planned', 25000, 'USD');
    PRAGMA user_version = 3;
  `);
  legacy.close();

  const upgraded = openDb(file, { createIfMissing: false });
  assert.equal(upgraded.pragma("user_version", { simple: true }), 4);
  assert.equal((upgraded.prepare("SELECT name FROM sponsors WHERE id = 'brand'").get() as { name: string }).name, "Korunacak Sponsor");
  assert.equal((upgraded.prepare("SELECT title FROM publications WHERE id = 'video'").get() as { title: string }).title, "Korunacak Video");
  assert.equal((upgraded.prepare("SELECT deleted_at FROM sponsors WHERE id = 'brand'").get() as { deleted_at: string | null }).deleted_at, null);
  assert.equal((upgraded.prepare("SELECT deleted_at FROM publications WHERE id = 'video'").get() as { deleted_at: string | null }).deleted_at, null);
  assert.equal(upgraded.pragma("integrity_check", { simple: true }), "ok");
  upgraded.close();
});

test("fresh databases start empty and require onboarding", () => {
  const db = openDb(":memory:");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sponsors").get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM schedule_slots").get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT onboarding_completed FROM workspace_settings WHERE id = 1").get() as { onboarding_completed: number }).onboarding_completed, 0);
  db.close();
});
