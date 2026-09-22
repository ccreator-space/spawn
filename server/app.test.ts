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
  const onboarded = await app.request("/api/onboarding", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({
    workspace_name: "Test Studio",
    slots: [{ weekday: 1, platform: "YouTube", format: "long", label: "Uzun video" }],
    sponsors: [{ client_id: "brand", name: "Test Marka", website_url: "https://example.com", logo_url: "https://example.com/logo.png", notes: "" }],
    publications: [], transactions: [],
  }) });
  assert.equal(onboarded.status, 201);
  const onboardingStatus = await (await app.request("/api/onboarding", { headers: { cookie } })).json();
  assert.deepEqual({ completed: onboardingStatus.completed, workspaceName: onboardingStatus.workspaceName, slotCount: onboardingStatus.slotCount, sponsorCount: onboardingStatus.sponsorCount }, { completed: true, workspaceName: "Test Studio", slotCount: 1, sponsorCount: 1 });
  const repeatedOnboarding = await app.request("/api/onboarding", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ workspace_name: "Silinmemeli", slots: [], sponsors: [], publications: [], transactions: [] }) });
  assert.equal(repeatedOnboarding.status, 409);
  const sponsor = await (await app.request("/api/sponsors", { headers: { cookie } })).json();
  const id = sponsor.sponsors.find((s: { name: string }) => s.name === "Test Marka").id;
  const content = { sponsor_id: id, platform: "YouTube", format: "long", slot_id: "yt-mon-long", title: "Sponsorlu video", planned_date: "2026-09-21", status: "planned", url: null, fee_minor: 100_000, currency: "USD", notes: "" };
  const created = await app.request("/api/publications", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(content) });
  assert.equal(created.status, 201);
  const publicationId = (await created.json()).id;
  const duplicate = await app.request("/api/publications", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(content) });
  assert.equal(duplicate.status, 409);
  const available = await (await app.request("/api/available?platform=YouTube&format=long&limit=20", { headers: { cookie } })).json();
  assert.equal(available.slots.some((slot: { date: string }) => slot.date === "2026-09-21"), false);
  const payment = await app.request("/api/transactions", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sponsor_id: id, publication_id: publicationId, kind: "income", amount_minor: 40_000, currency: "USD", occurred_on: "2026-09-22", note: "Kısmi ödeme" }) });
  assert.equal(payment.status, 201);
  const paymentId = (await payment.json()).id;
  const corrected = await app.request(`/api/transactions/${paymentId}`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sponsor_id: id, publication_id: publicationId, kind: "income", amount_minor: 45_000, currency: "USD", occurred_on: "2026-09-22", note: "Düzeltilmiş kısmi ödeme" }) });
  assert.equal(corrected.status, 200);
  const credit = await app.request("/api/transactions", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ sponsor_id: id, kind: "credit", amount_minor: 10_000, currency: "USD", occurred_on: "2026-09-22", note: "Platform kredisi" }) });
  assert.equal(credit.status, 201);
  const detail = await (await app.request(`/api/sponsors/${id}`, { headers: { cookie } })).json();
  assert.equal(detail.planned, 1);
  assert.equal(detail.published, 0);
  assert.equal(detail.money.USD.contracted, 100_000);
  assert.equal(detail.money.USD.received, 45_000);
  assert.equal(detail.money.USD.credit, 10_000);
  assert.equal(detail.money.USD.outstanding, 45_000);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE entity = 'transaction' AND action = 'update'").get() as { n: number }).n, 1);

  const removedPublication = await app.request(`/api/publications/${publicationId}`, { method: "DELETE", headers: { cookie } });
  assert.equal(removedPublication.status, 200);
  assert.equal((await removedPublication.json()).preservedTransactions, 1);
  assert.equal((await (await app.request(`/api/publications?sponsor=${id}`, { headers: { cookie } })).json()).publications.length, 0);
  assert.ok((db.prepare("SELECT deleted_at FROM publications WHERE id = ?").get(publicationId) as { deleted_at: string }).deleted_at);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE publication_id = ?").get(publicationId) as { n: number }).n, 1);

  const replacement = await app.request("/api/publications", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(content) });
  assert.equal(replacement.status, 201, "a removed calendar slot can be reused");
  const removedSponsor = await app.request(`/api/sponsors/${id}`, { method: "DELETE", headers: { cookie } });
  assert.equal(removedSponsor.status, 200);
  assert.deepEqual((await removedSponsor.json()).preserved, { publications: 1, transactions: 2 });
  assert.equal((await (await app.request("/api/sponsors", { headers: { cookie } })).json()).sponsors.length, 0);
  assert.equal((await app.request(`/api/sponsors/${id}`, { headers: { cookie } })).status, 404);
  const historicalTransactions = await (await app.request("/api/transactions", { headers: { cookie } })).json();
  assert.equal(historicalTransactions.transactions.length, 2);
  assert.equal(historicalTransactions.transactions[0].sponsor_name, "Test Marka");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = 'delete'").get() as { n: number }).n, 2);
  db.close();
});
