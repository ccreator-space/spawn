import test from "node:test";
import assert from "node:assert/strict";
import { openDb } from "./db.js";
import { replaceBusinessData, type BusinessDataManifest } from "./business-data.js";

function manifest(): BusinessDataManifest {
  return {
    version: 1,
    sponsors: [{ id: "new-brand", slug: "new-brand", name: "Yeni Marka", website_url: null, logo_url: null, notes: "" }],
    publications: [{ id: "new-video", sponsor_id: "new-brand", platform: "YouTube", format: "long", slot_id: "yt-mon-long", title: "Yeni video", planned_date: "2026-09-28", published_date: "2026-09-28", status: "published", url: "https://example.com/video", fee_minor: 10_000, currency: "USD", notes: "" }],
    transactions: [{ id: "new-payment", sponsor_id: "new-brand", publication_id: "new-video", kind: "income", amount_minor: 480_000, currency: "TRY", applied_minor: 10_000, applied_currency: "USD", occurred_on: "2026-09-29", note: "" }],
  };
}

test("business data replacement is atomic and preserves account and schedule data", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run("owner", "owner@example.com", "hash");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run("session", "owner", "2099-01-01");
  db.prepare("INSERT INTO schedule_slots (id, weekday, platform, format, label) VALUES (?, ?, ?, ?, ?)").run("yt-mon-long", 1, "YouTube", "long", "Uzun video");
  db.prepare("INSERT INTO sponsors (id, slug, name) VALUES (?, ?, ?)").run("old-brand", "old-brand", "Eski Marka");

  const result = replaceBusinessData(db, manifest());
  assert.deepEqual(result, { sponsors: 1, publications: 1, transactions: 1, preserved: { users: 1, sessions: 1, slots: 1, settings: 1 } });
  assert.equal((db.prepare("SELECT name FROM sponsors").get() as { name: string }).name, "Yeni Marka");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM schedule_slots").get() as { n: number }).n, 1);
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  db.close();
});

test("invalid replacement rolls back without removing existing data", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO schedule_slots (id, weekday, platform, format, label) VALUES (?, ?, ?, ?, ?)").run("yt-mon-long", 1, "YouTube", "long", "Uzun video");
  db.prepare("INSERT INTO sponsors (id, slug, name) VALUES (?, ?, ?)").run("old-brand", "old-brand", "Eski Marka");
  const invalid = manifest();
  invalid.transactions[0]!.sponsor_id = "missing-brand";
  assert.throws(() => replaceBusinessData(db, invalid), /Unknown sponsor/);
  assert.equal((db.prepare("SELECT name FROM sponsors").get() as { name: string }).name, "Eski Marka");
  db.close();
});
