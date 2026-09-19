import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDb } from "./db.js";
import { hashPassword } from "./auth.js";
import { createApp } from "./app.js";
import { slotsForWeek } from "./schedule.js";

test("weekly plan contains the supplied cadence", () => {
  const slots = slotsForWeek("2026-09-21");
  assert.equal(slots.length, 25);
  assert.equal(slots.filter((s) => s.platform === "YouTube" && s.format === "long").length, 3);
  assert.equal(slots.filter((s) => s.platform === "YouTube" && s.format === "short").length, 4);
  assert.equal(slots.find((s) => s.id === "yt-fri-long")?.date, "2026-09-25");
});

test("local first-run setup creates only one administrator", async () => {
  const db = openDb(":memory:");
  const app = createApp(db);
  const before = await (await app.request("/api/setup-status")).json();
  assert.equal(before.needsSetup, true);
  const shortPassword = await app.request("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "short" }) });
  assert.equal(shortPassword.status, 400);
  const request = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "a-long-private-password" }) };
  const created = await app.request("/api/setup", request);
  assert.equal(created.status, 201);
  assert.ok(created.headers.get("set-cookie")?.includes("HttpOnly"));
  const second = await app.request("/api/setup", request);
  assert.equal(second.status, 409);
  const after = await (await app.request("/api/setup-status")).json();
  assert.equal(after.needsSetup, false);
  db.close();
});

test("sponsor, publication, receipt and remaining balance stay distinct", async () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(randomUUID(), "test@example.com", hashPassword("long-test-password"));
  const app = createApp(db);
  const login = await app.request("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "test@example.com", password: "long-test-password" }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const sponsor = await (await app.request("/api/sponsors", { headers: { cookie } })).json();
  const id = sponsor.sponsors.find((s: { slug: string }) => s.slug === "hostinger").id;
  const content = { sponsor_id: id, platform: "YouTube", format: "long", slot_id: "yt-mon-long", title: "Sponsorlu video", planned_date: "2026-09-21", status: "planned", url: null, fee_minor: 100_000, currency: "USD", notes: "" };
  const created = await app.request("/api/publications", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(content) });
  assert.equal(created.status, 201);
  const duplicate = await app.request("/api/publications", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(content) });
  assert.equal(duplicate.status, 409);
  const available = await (await app.request("/api/available?platform=YouTube&format=long&limit=20", { headers: { cookie } })).json();
  assert.equal(available.slots.some((slot: { date: string; id: string }) => slot.date === "2026-09-21" && slot.id === "yt-mon-long"), false);
  const payment = await app.request("/api/transactions", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sponsor_id: id, kind: "income", amount_minor: 40_000, currency: "USD", occurred_on: "2026-09-22", note: "Kısmi ödeme" }) });
  assert.equal(payment.status, 201);
  const paymentId = (await payment.json()).id;
  const corrected = await app.request(`/api/transactions/${paymentId}`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sponsor_id: id, kind: "income", amount_minor: 45_000, currency: "USD", occurred_on: "2026-09-22", note: "Düzeltilmiş kısmi ödeme" }) });
  assert.equal(corrected.status, 200);
  const detail = await (await app.request(`/api/sponsors/${id}`, { headers: { cookie } })).json();
  assert.equal(detail.planned, 1);
  assert.equal(detail.published, 0);
  assert.equal(detail.money.USD.contracted, 100_000);
  assert.equal(detail.money.USD.received, 45_000);
  assert.equal(detail.money.USD.outstanding, 55_000);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE entity = 'transaction' AND action = 'update'").get() as { n: number }).n, 1);
  db.close();
});
