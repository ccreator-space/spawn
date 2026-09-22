import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Db } from "./db.js";
import { checkPassword, createSession, hashPassword, sessionUser, tokenHash } from "./auth.js";
import { publicationPayment, summarizeMoney } from "./finance.js";
import { latestRate } from "./rates.js";
import { mondayOf, slotsForWeek, validDate, type Slot } from "./schedule.js";

type Sponsor = { id: string; slug: string; name: string; website_url: string | null; logo_url: string | null; notes: string; deleted_at?: string | null };
type Publication = {
  id: string; sponsor_id: string | null; platform: string; format: string; slot_id: string | null;
  title: string; planned_date: string; published_date: string | null; status: string;
  url: string | null; fee_minor: number; currency: string; notes: string; sponsor_name?: string | null;
  deleted_at?: string | null;
};
type Transaction = {
  id: string; sponsor_id: string | null; publication_id: string | null; kind: string;
  amount_minor: number; currency: string; applied_minor: number | null; applied_currency: string | null;
  occurred_on: string; note: string; publication_title?: string | null;
};

const failedLogins = new Map<string, { count: number; until: number }>();
const videoFormats = new Set(["long", "short", "reel", "tiktok", "teaser"]);
const platforms = new Set(["YouTube", "Instagram", "TikTok", "LinkedIn", "X"]);
const currencyOk = (value: unknown): value is "TRY" | "USD" => value === "TRY" || value === "USD";
const statusOk = (value: unknown) => value === "planned" || value === "published" || value === "cancelled";
const isUrl = (value: unknown) => !value || (typeof value === "string" && /^https?:\/\//i.test(value));
const isAssetUrl = (value: unknown) => !value || (typeof value === "string" && (/^https?:\/\//i.test(value) || /^\/[a-z0-9/_\-.]+$/i.test(value)));
const textValue = (value: unknown, max = 1000) => typeof value === "string" ? value.trim().slice(0, max) : "";
const positiveMinor = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nonnegativeMinor = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const slugify = (value: string) => value.toLocaleLowerCase("tr").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sponsor";
const savedSlots = (db: Db) => db.prepare("SELECT id, weekday, platform, format, label, sort_order FROM schedule_slots ORDER BY weekday, sort_order, created_at").all() as Slot[];

export function createApp(db: Db) {
  const app = new Hono<{ Variables: { user: { id: string; email: string } } }>();
  const origin = process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3001}`;
  const localSetup = process.env.NODE_ENV !== "production";

  app.use("/api/*", async (c, next) => {
    const method = c.req.method;
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      const requestOrigin = c.req.header("origin");
      if (requestOrigin && requestOrigin !== origin) return c.json({ error: "Geçersiz istek kaynağı." }, 403);
    }
    if (["/api/login", "/api/health", "/api/setup-status", "/api/setup"].includes(c.req.path)) return next();
    const user = sessionUser(db, getCookie(c, "session"));
    if (!user) return c.json({ error: "Oturum açmanız gerekiyor." }, 401);
    c.set("user", user);
    return next();
  });

  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/setup-status", (c) => c.json({ needsSetup: localSetup && !db.prepare("SELECT 1 FROM users LIMIT 1").get() }));
  app.post("/api/setup", async (c) => {
    if (!localSetup) return c.json({ error: "İlk kullanıcı sunucu komutuyla oluşturulmalıdır." }, 403);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const email = textValue(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12)
      return c.json({ error: "Geçerli e-posta ve en az 12 karakterli parola girin." }, 400);
    const id = randomUUID();
    const passwordHash = hashPassword(password);
    const created = db.transaction(() => {
      if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) return false;
      db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(id, email, passwordHash);
      return true;
    })();
    if (!created) return c.json({ error: "Yönetici hesabı zaten oluşturulmuş." }, 409);
    const token = createSession(db, id);
    setCookie(c, "session", token, { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
    return c.json({ user: { id, email } }, 201);
  });
  app.post("/api/login", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const email = textValue(body.email, 254).toLowerCase();
    const password = typeof body.password === "string" ? body.password : "";
    const attempt = failedLogins.get(email);
    if (attempt && attempt.count >= 5 && attempt.until > Date.now()) return c.json({ error: "Çok fazla deneme. Biraz bekleyin." }, 429);
    const user = db.prepare("SELECT id, email, password_hash FROM users WHERE email = ?").get(email) as { id: string; email: string; password_hash: string } | undefined;
    if (!user || !checkPassword(password, user.password_hash)) {
      if (failedLogins.size > 1000) failedLogins.clear();
      failedLogins.set(email, { count: (attempt?.until && attempt.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 15 * 60 * 1000 });
      return c.json({ error: "E-posta veya parola hatalı." }, 401);
    }
    failedLogins.delete(email);
    const token = createSession(db, user.id);
    setCookie(c, "session", token, { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 14 });
    return c.json({ user: { id: user.id, email: user.email } });
  });
  app.post("/api/logout", (c) => {
    const token = getCookie(c, "session");
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
    deleteCookie(c, "session", { path: "/" });
    return c.json({ ok: true });
  });
  app.get("/api/me", (c) => c.json({ user: c.get("user") }));

  app.get("/api/onboarding", (c) => {
    const settings = db.prepare("SELECT workspace_name, onboarding_completed FROM workspace_settings WHERE id = 1").get() as { workspace_name: string; onboarding_completed: number };
    return c.json({
      completed: settings.onboarding_completed === 1,
      workspaceName: settings.workspace_name,
      slotCount: (db.prepare("SELECT COUNT(*) AS n FROM schedule_slots").get() as { n: number }).n,
      sponsorCount: (db.prepare("SELECT COUNT(*) AS n FROM sponsors").get() as { n: number }).n,
    });
  });

  app.post("/api/onboarding", async (c) => {
    const settings = db.prepare("SELECT onboarding_completed FROM workspace_settings WHERE id = 1").get() as { onboarding_completed: number };
    if (settings.onboarding_completed === 1) return c.json({ error: "İlk kurulum daha önce tamamlanmış." }, 409);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const workspaceName = textValue(body.workspace_name, 80);
    const slots = Array.isArray(body.slots) ? body.slots as Array<Record<string, unknown>> : [];
    const sponsors = Array.isArray(body.sponsors) ? body.sponsors as Array<Record<string, unknown>> : [];
    const publications = Array.isArray(body.publications) ? body.publications as Array<Record<string, unknown>> : [];
    const transactions = Array.isArray(body.transactions) ? body.transactions as Array<Record<string, unknown>> : [];
    const error = validateOnboarding(workspaceName, slots, sponsors, publications, transactions);
    if (error) return c.json({ error }, 400);

    try {
      const counts = db.transaction(() => {
        const insertedSlots: Slot[] = [];
        const insertSlot = db.prepare("INSERT INTO schedule_slots (id, weekday, platform, format, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
        slots.forEach((item, index) => {
          const slot = { id: randomUUID(), weekday: Number(item.weekday), platform: textValue(item.platform, 30), format: textValue(item.format, 30), label: textValue(item.label, 120), sort_order: index };
          insertSlot.run(slot.id, slot.weekday, slot.platform, slot.format, slot.label, index);
          insertedSlots.push(slot);
        });

        const sponsorIds = new Map<string, string>();
        const insertSponsor = db.prepare("INSERT INTO sponsors (id, slug, name, website_url, logo_url, notes) VALUES (?, ?, ?, ?, ?, ?)");
        for (const item of sponsors) {
          const id = randomUUID();
          const clientId = textValue(item.client_id, 100);
          const name = textValue(item.name, 120);
          insertSponsor.run(id, `${slugify(name)}-${id.slice(0, 6)}`, name, textValue(item.website_url, 500) || null, textValue(item.logo_url, 1000) || null, textValue(item.notes, 5000));
          sponsorIds.set(clientId, id);
        }

        const insertPublication = db.prepare(`INSERT INTO publications
          (id, sponsor_id, platform, format, slot_id, title, planned_date, published_date, status, url, fee_minor, currency, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const item of publications) {
          const sponsorId = sponsorIds.get(textValue(item.sponsor_ref, 100)) || null;
          const plannedDate = String(item.planned_date);
          const platform = textValue(item.platform, 30);
          const format = textValue(item.format, 30);
          const weekday = new Date(`${plannedDate}T12:00:00Z`).getUTCDay();
          const slotId = insertedSlots.find((slot) => slot.weekday === weekday && slot.platform === platform && slot.format === format)?.id ?? null;
          insertPublication.run(randomUUID(), sponsorId, platform, format, slotId, textValue(item.title, 240), plannedDate,
            item.status === "published" ? (item.published_date || plannedDate) : null, item.status, textValue(item.url, 1000) || null,
            sponsorId ? item.fee_minor : 0, item.currency, textValue(item.notes, 5000));
        }

        const insertTransaction = db.prepare(`INSERT INTO transactions
          (id, sponsor_id, kind, amount_minor, currency, occurred_on, note) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        for (const item of transactions) {
          const sponsorId = sponsorIds.get(textValue(item.sponsor_ref, 100)) || null;
          insertTransaction.run(randomUUID(), sponsorId, item.kind, item.amount_minor, item.currency, item.occurred_on, textValue(item.note, 1000));
        }
        db.prepare("UPDATE workspace_settings SET workspace_name = ?, onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run(workspaceName);
        log("workspace", "1", "onboarding", c.get("user").id);
        return { slots: slots.length, sponsors: sponsors.length, publications: publications.length, transactions: transactions.length };
      })();
      return c.json({ ok: true, workspaceName, counts }, 201);
    } catch (caught) {
      if (String(caught).includes("UNIQUE")) return c.json({ error: "Aynı tarih ve takvim yuvası için birden fazla içerik var." }, 409);
      throw caught;
    }
  });

  app.get("/api/sponsors", (c) => {
    const sponsors = db.prepare("SELECT id, slug, name, website_url, logo_url, notes FROM sponsors WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE").all() as Sponsor[];
    const publications = db.prepare("SELECT id, sponsor_id, format, fee_minor, currency, status FROM publications WHERE sponsor_id IS NOT NULL AND deleted_at IS NULL").all() as Array<Publication>;
    const transactions = db.prepare("SELECT sponsor_id, publication_id, kind, amount_minor, currency, applied_minor, applied_currency FROM transactions WHERE sponsor_id IS NOT NULL").all() as Array<Transaction>;
    return c.json({ sponsors: sponsors.map((sponsor) => {
      const items = publications.filter((item) => item.sponsor_id === sponsor.id);
      const money = summarizeMoney(items, transactions.filter((item) => item.sponsor_id === sponsor.id));
      return { ...sponsor, published: items.filter((item) => item.status === "published" && videoFormats.has(item.format)).length, planned: items.filter((item) => item.status === "planned" && videoFormats.has(item.format)).length, money };
    }) });
  });
  app.post("/api/sponsors", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const name = textValue(body.name, 120);
    if (!name || !isUrl(body.website_url) || !isAssetUrl(body.logo_url)) return c.json({ error: "Geçerli sponsor adı, web sitesi ve logo bağlantısı girin." }, 400);
    const id = randomUUID();
    const slug = `${slugify(name)}-${id.slice(0, 6)}`;
    db.prepare("INSERT INTO sponsors (id, slug, name, website_url, logo_url, notes) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, slug, name, textValue(body.website_url, 500) || null, textValue(body.logo_url, 1000) || null, textValue(body.notes, 5000));
    log("sponsor", id, "create", c.get("user").id);
    return c.json({ id }, 201);
  });
  app.get("/api/sponsors/:id", (c) => {
    const id = c.req.param("id");
    const sponsor = db.prepare("SELECT * FROM sponsors WHERE id = ? AND deleted_at IS NULL").get(id) as Sponsor | undefined;
    if (!sponsor) return c.json({ error: "Sponsor bulunamadı." }, 404);
    const publications = db.prepare("SELECT * FROM publications WHERE sponsor_id = ? AND deleted_at IS NULL ORDER BY planned_date DESC").all(id) as Publication[];
    const transactions = db.prepare(`SELECT transactions.*, publications.title AS publication_title FROM transactions
      LEFT JOIN publications ON publications.id = transactions.publication_id
      WHERE transactions.sponsor_id = ? ORDER BY occurred_on DESC, transactions.created_at DESC`).all(id) as Transaction[];
    return c.json({ sponsor, publications: publications.map((publication) => ({ ...publication, ...publicationPayment(publication, transactions) })), transactions, money: summarizeMoney(publications, transactions), published: publications.filter((p) => p.status === "published" && videoFormats.has(p.format)).length, planned: publications.filter((p) => p.status === "planned" && videoFormats.has(p.format)).length });
  });
  app.patch("/api/sponsors/:id", async (c) => {
    const id = c.req.param("id");
    if (!db.prepare("SELECT 1 FROM sponsors WHERE id = ? AND deleted_at IS NULL").get(id)) return c.json({ error: "Sponsor bulunamadı." }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const name = textValue(body.name, 120);
    if (!name || !isUrl(body.website_url) || !isAssetUrl(body.logo_url)) return c.json({ error: "Geçerli sponsor adı, web sitesi ve logo bağlantısı girin." }, 400);
    db.prepare("UPDATE sponsors SET name = ?, website_url = ?, logo_url = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(name, textValue(body.website_url, 500) || null, textValue(body.logo_url, 1000) || null, textValue(body.notes, 5000), id);
    log("sponsor", id, "update", c.get("user").id);
    return c.json({ ok: true });
  });
  app.delete("/api/sponsors/:id", (c) => {
    const id = c.req.param("id");
    const sponsor = db.prepare("SELECT * FROM sponsors WHERE id = ? AND deleted_at IS NULL").get(id) as Sponsor | undefined;
    if (!sponsor) return c.json({ error: "Sponsor bulunamadı." }, 404);
    const counts = {
      publications: (db.prepare("SELECT COUNT(*) AS n FROM publications WHERE sponsor_id = ? AND deleted_at IS NULL").get(id) as { n: number }).n,
      transactions: (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE sponsor_id = ?").get(id) as { n: number }).n,
    };
    db.transaction(() => {
      db.prepare("UPDATE sponsors SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      db.prepare("INSERT INTO activity_log (id, user_id, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), c.get("user").id, "sponsor", id, "delete", JSON.stringify({ sponsor, preserved: counts }));
    })();
    return c.json({ ok: true, preserved: counts });
  });

  app.get("/api/schedule", (c) => {
    const requested = c.req.query("week");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const monday = mondayOf(validDate(requested) ? requested : today);
    const end = new Date(`${monday}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 6);
    const endString = end.toISOString().slice(0, 10);
    const publications = db.prepare(`SELECT publications.*, sponsors.name AS sponsor_name FROM publications
      LEFT JOIN sponsors ON sponsors.id = publications.sponsor_id
      WHERE publications.deleted_at IS NULL AND planned_date BETWEEN ? AND ? ORDER BY planned_date, platform`).all(monday, endString) as Publication[];
    return c.json({ monday, slots: slotsForWeek(monday, savedSlots(db)), publications });
  });
  app.get("/api/available", (c) => {
    const platform = c.req.query("platform") || "YouTube";
    const format = c.req.query("format") || "long";
    const limit = Math.min(Math.max(Number(c.req.query("limit") || 6), 1), 20);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const firstWeek = mondayOf(today);
    const occupied = new Set((db.prepare(`SELECT planned_date || ':' || slot_id AS key FROM publications
      WHERE deleted_at IS NULL AND status != 'cancelled' AND slot_id IS NOT NULL AND planned_date >= ?`).all(today) as Array<{ key: string }>).map((row) => row.key));
    const available: ReturnType<typeof slotsForWeek> = [];
    for (let week = 0; week < 24 && available.length < limit; week++) {
      const start = new Date(`${firstWeek}T12:00:00Z`);
      start.setUTCDate(start.getUTCDate() + week * 7);
      const slots = slotsForWeek(start.toISOString().slice(0, 10), savedSlots(db));
      for (const slot of slots) {
        if (slot.platform === platform && slot.format === format && slot.date >= today && !occupied.has(`${slot.date}:${slot.id}`)) available.push(slot);
        if (available.length >= limit) break;
      }
    }
    return c.json({ slots: available });
  });
  app.get("/api/publications", (c) => {
    const sponsorId = c.req.query("sponsor");
    const rows = (sponsorId ? db.prepare("SELECT * FROM publications WHERE sponsor_id = ? AND deleted_at IS NULL ORDER BY planned_date DESC").all(sponsorId) : db.prepare("SELECT * FROM publications WHERE deleted_at IS NULL ORDER BY planned_date DESC LIMIT 200").all()) as Publication[];
    const transactions = (sponsorId ? db.prepare("SELECT * FROM transactions WHERE sponsor_id = ?").all(sponsorId) : db.prepare("SELECT * FROM transactions").all()) as Transaction[];
    return c.json({ publications: rows.map((publication) => ({ ...publication, ...publicationPayment(publication, transactions) })) });
  });
  app.post("/api/publications", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    body.slot_id = resolvedSlotId(body, db);
    const error = validatePublication(body, db);
    if (error) return c.json({ error }, 400);
    const id = randomUUID();
    try {
      db.prepare(`INSERT INTO publications
        (id, sponsor_id, platform, format, slot_id, title, planned_date, published_date, status, url, fee_minor, currency, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, body.sponsor_id || null, body.platform, body.format, body.slot_id || null, textValue(body.title, 240), body.planned_date,
          body.status === "published" ? (body.published_date || body.planned_date) : null,
          body.status, textValue(body.url, 1000) || null, body.sponsor_id ? body.fee_minor : 0, body.currency, textValue(body.notes, 5000),
        );
    } catch (error) {
      if (String(error).includes("UNIQUE")) return c.json({ error: "Bu yayın yuvası dolu." }, 409);
      throw error;
    }
    log("publication", id, "create", c.get("user").id);
    return c.json({ id }, 201);
  });
  app.patch("/api/publications/:id", async (c) => {
    const id = c.req.param("id");
    if (!db.prepare("SELECT 1 FROM publications WHERE id = ? AND deleted_at IS NULL").get(id)) return c.json({ error: "Yayın bulunamadı." }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    body.slot_id = resolvedSlotId(body, db);
    const error = validatePublication(body, db);
    if (error) return c.json({ error }, 400);
    try {
      db.prepare(`UPDATE publications SET sponsor_id = ?, platform = ?, format = ?, slot_id = ?, title = ?, planned_date = ?,
        published_date = ?, status = ?, url = ?, fee_minor = ?, currency = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
          body.sponsor_id || null, body.platform, body.format, body.slot_id || null, textValue(body.title, 240), body.planned_date,
          body.status === "published" ? (body.published_date || body.planned_date) : null,
          body.status, textValue(body.url, 1000) || null, body.sponsor_id ? body.fee_minor : 0, body.currency, textValue(body.notes, 5000), id,
        );
    } catch (error) {
      if (String(error).includes("UNIQUE")) return c.json({ error: "Bu yayın yuvası dolu." }, 409);
      throw error;
    }
    log("publication", id, "update", c.get("user").id);
    return c.json({ ok: true });
  });
  app.delete("/api/publications/:id", (c) => {
    const id = c.req.param("id");
    const publication = db.prepare("SELECT * FROM publications WHERE id = ? AND deleted_at IS NULL").get(id) as Publication | undefined;
    if (!publication) return c.json({ error: "Yayın bulunamadı." }, 404);
    const linkedTransactions = (db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE publication_id = ?").get(id) as { n: number }).n;
    db.transaction(() => {
      db.prepare("UPDATE publications SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      db.prepare("INSERT INTO activity_log (id, user_id, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), c.get("user").id, "publication", id, "delete", JSON.stringify({ publication, preservedTransactions: linkedTransactions }));
    })();
    return c.json({ ok: true, preservedTransactions: linkedTransactions });
  });

  app.get("/api/transactions", (c) => c.json({ transactions: db.prepare(`SELECT transactions.*, sponsors.name AS sponsor_name, publications.title AS publication_title
    FROM transactions LEFT JOIN sponsors ON sponsors.id = transactions.sponsor_id
    LEFT JOIN publications ON publications.id = transactions.publication_id
    ORDER BY occurred_on DESC, created_at DESC LIMIT 300`).all() }));
  app.post("/api/transactions", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const error = validateTransaction(body, db);
    if (error) return c.json({ error }, 400);
    const sponsorId = textValue(body.sponsor_id, 100) || null;
    const publicationId = textValue(body.publication_id, 100) || null;
    const id = randomUUID();
    db.prepare(`INSERT INTO transactions (id, sponsor_id, publication_id, kind, amount_minor, currency, applied_minor, applied_currency, occurred_on, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sponsorId, publicationId, body.kind, body.amount_minor, body.currency,
        publicationId ? body.applied_minor : null, publicationId ? body.applied_currency : null, body.occurred_on, textValue(body.note, 1000));
    log("transaction", id, "create", c.get("user").id);
    return c.json({ id }, 201);
  });
  app.patch("/api/transactions/:id", async (c) => {
    const id = c.req.param("id");
    const previous = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Transaction | undefined;
    if (!previous) return c.json({ error: "İşlem bulunamadı." }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const error = validateTransaction(body, db);
    if (error) return c.json({ error }, 400);
    db.transaction(() => {
      const publicationId = textValue(body.publication_id, 100) || null;
      db.prepare(`UPDATE transactions SET sponsor_id = ?, publication_id = ?, kind = ?, amount_minor = ?, currency = ?, applied_minor = ?, applied_currency = ?, occurred_on = ?, note = ? WHERE id = ?`)
        .run(textValue(body.sponsor_id, 100) || null, publicationId, body.kind, body.amount_minor, body.currency,
          publicationId ? body.applied_minor : null, publicationId ? body.applied_currency : null, body.occurred_on, textValue(body.note, 1000), id);
      db.prepare("INSERT INTO activity_log (id, user_id, entity, entity_id, action, detail) VALUES (?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), c.get("user").id, "transaction", id, "update", JSON.stringify(previous));
    })();
    return c.json({ ok: true });
  });
  app.get("/api/dashboard", (c) => {
    const publications = db.prepare("SELECT id, sponsor_id, fee_minor, currency, status, planned_date FROM publications WHERE deleted_at IS NULL").all() as Publication[];
    const transactions = db.prepare("SELECT publication_id, kind, amount_minor, currency, applied_minor, applied_currency FROM transactions").all() as Transaction[];
    const sponsorCount = (db.prepare("SELECT COUNT(*) AS n FROM sponsors WHERE deleted_at IS NULL").get() as { n: number }).n;
    return c.json({ sponsorCount, publicationCount: publications.length, publishedCount: publications.filter((p) => p.status === "published").length,
      plannedCount: publications.filter((p) => p.status === "planned").length, money: summarizeMoney(publications, transactions) });
  });
  app.get("/api/rate", async (c) => c.json({ rate: await latestRate() }));

  const webRoot = join(process.cwd(), "dist-web");
  app.use("/assets/*", serveStatic({ root: webRoot }));
  app.use("/sponsors/*", serveStatic({ root: webRoot }));
  app.use("/logo.png", serveStatic({ root: webRoot }));
  app.use("/favicon.ico", serveStatic({ root: webRoot }));
  app.get("/*", (c) => {
    try { return c.html(readFileSync(join(webRoot, "index.html"), "utf8")); }
    catch { return c.text("Run pnpm build or open the Vite dev server.", 404); }
  });

  function log(entity: string, entityId: string, action: string, userId: string) {
    db.prepare("INSERT INTO activity_log (id, user_id, entity, entity_id, action) VALUES (?, ?, ?, ?, ?)")
      .run(randomUUID(), userId, entity, entityId, action);
  }
  return app;
}

function validatePublication(body: Record<string, unknown>, db: Db): string | null {
  if (!textValue(body.title, 240) || !validDate(body.planned_date) || !statusOk(body.status) || !currencyOk(body.currency) || !nonnegativeMinor(body.fee_minor))
    return "Başlık, tarih, durum, para birimi veya ücret geçersiz.";
  if (!isUrl(body.url)) return "Geçerli yayın bağlantısı girin.";
  if (body.status === "published" && !body.url) return "Yayımlanan içerik için bağlantı girin.";
  if (body.status === "published" && body.published_date && !validDate(body.published_date)) return "Gerçek yayın tarihi geçersiz.";
  const slot = body.slot_id ? savedSlots(db).find((s) => s.id === body.slot_id) : null;
  if (body.slot_id && (!slot || slot.platform !== body.platform || slot.format !== body.format || new Date(`${body.planned_date}T12:00:00Z`).getUTCDay() !== slot.weekday))
    return "Seçilen yayın yuvası tarih veya platformla eşleşmiyor.";
  if (!body.slot_id && (typeof body.platform !== "string" || typeof body.format !== "string" || !platforms.has(body.platform)))
    return "Geçerli platform ve format seçin.";
  if (body.sponsor_id && !db.prepare("SELECT 1 FROM sponsors WHERE id = ? AND deleted_at IS NULL").get(body.sponsor_id)) return "Sponsor bulunamadı.";
  if (!body.sponsor_id && body.fee_minor !== 0) return "Ücret için sponsor seçin.";
  return null;
}

function resolvedSlotId(body: Record<string, unknown>, db: Db): string | null {
  if (!validDate(body.planned_date) || typeof body.platform !== "string" || typeof body.format !== "string") return null;
  const slots = savedSlots(db);
  const requested = typeof body.slot_id === "string" ? slots.find((slot) => slot.id === body.slot_id) : undefined;
  if (requested) return requested.id;
  const weekday = new Date(`${body.planned_date}T12:00:00Z`).getUTCDay();
  return slots.find((slot) => slot.weekday === weekday && slot.platform === body.platform && slot.format === body.format)?.id ?? null;
}

function validateTransaction(body: Record<string, unknown>, db: Db): string | null {
  if ((body.kind !== "income" && body.kind !== "expense" && body.kind !== "credit") || !positiveMinor(body.amount_minor) || !currencyOk(body.currency) || !validDate(body.occurred_on))
    return "İşlem türü, tutar, para birimi veya tarih geçersiz.";
  const sponsorId = textValue(body.sponsor_id, 100) || null;
  if ((body.kind === "income" || body.kind === "credit") && !sponsorId) return "Tahsilat veya platform kredisi için sponsor seçin.";
  if (sponsorId && !db.prepare("SELECT 1 FROM sponsors WHERE id = ? AND deleted_at IS NULL").get(sponsorId)) return "Sponsor bulunamadı.";
  const publicationId = textValue(body.publication_id, 100) || null;
  if (publicationId) {
    if (body.kind === "expense") return "Gider bir sponsor videosuna bağlanamaz.";
    const publication = db.prepare("SELECT sponsor_id, currency FROM publications WHERE id = ? AND deleted_at IS NULL").get(publicationId) as { sponsor_id: string | null; currency: string } | undefined;
    if (!publication || publication.sponsor_id !== sponsorId) return "İşlem videosu sponsorla eşleşmiyor.";
    if (!positiveMinor(body.applied_minor) || body.applied_currency !== publication.currency) return "Videoya işlenecek tutar geçersiz.";
  } else if (body.applied_minor || body.applied_currency) {
    return "Videoya işlenen tutar için ilgili videoyu seçin.";
  }
  return null;
}

function validateOnboarding(
  workspaceName: string,
  slots: Array<Record<string, unknown>>,
  sponsors: Array<Record<string, unknown>>,
  publications: Array<Record<string, unknown>>,
  transactions: Array<Record<string, unknown>>,
): string | null {
  if (!workspaceName) return "Çalışma alanı adını girin.";
  if (slots.length < 1 || slots.length > 100) return "Takvime en az bir, en fazla 100 yayın yuvası ekleyin.";
  const slotKeys = new Set<string>();
  for (const slot of slots) {
    if (typeof slot.weekday !== "number" || !Number.isInteger(slot.weekday) || slot.weekday < 0 || slot.weekday > 6 || !platforms.has(String(slot.platform)) || !textValue(slot.format, 30) || !textValue(slot.label, 120))
      return "Takvimde geçersiz gün, platform, format veya başlık var.";
    const key = `${slot.weekday}:${slot.platform}:${slot.format}`;
    if (slotKeys.has(key)) return "Aynı gün, platform ve format için yalnızca bir yuva eklenebilir.";
    slotKeys.add(key);
  }
  if (sponsors.length > 100 || publications.length > 500 || transactions.length > 500) return "İlk kurulum için çok fazla kayıt eklendi.";
  const sponsorRefs = new Set<string>();
  for (const sponsor of sponsors) {
    const ref = textValue(sponsor.client_id, 100);
    if (!ref || sponsorRefs.has(ref) || !textValue(sponsor.name, 120) || !isUrl(sponsor.website_url) || !isAssetUrl(sponsor.logo_url))
      return "Sponsor adı, web sitesi veya logo bağlantısı geçersiz.";
    sponsorRefs.add(ref);
  }
  for (const publication of publications) {
    const sponsorRef = textValue(publication.sponsor_ref, 100);
    if (sponsorRef && !sponsorRefs.has(sponsorRef)) return "Geçmiş içerikte seçilen sponsor bulunamadı.";
    if (!textValue(publication.title, 240) || !validDate(publication.planned_date) || !platforms.has(String(publication.platform)) || !textValue(publication.format, 30) || !statusOk(publication.status) || !currencyOk(publication.currency) || !nonnegativeMinor(publication.fee_minor) || !isUrl(publication.url))
      return "Geçmiş içerik bilgilerinden biri geçersiz.";
    if (publication.status === "published" && !publication.url) return "Yayımlanmış içerik için bağlantı girin.";
    if (publication.status === "published" && publication.published_date && !validDate(publication.published_date)) return "Gerçek yayın tarihi geçersiz.";
    if (!sponsorRef && publication.fee_minor !== 0) return "Ücretli geçmiş içerik için sponsor seçin.";
  }
  for (const transaction of transactions) {
    const sponsorRef = textValue(transaction.sponsor_ref, 100);
    if (sponsorRef && !sponsorRefs.has(sponsorRef)) return "Finans kaydında seçilen sponsor bulunamadı.";
    if ((transaction.kind !== "income" && transaction.kind !== "expense" && transaction.kind !== "credit") || !positiveMinor(transaction.amount_minor) || !currencyOk(transaction.currency) || !validDate(transaction.occurred_on))
      return "Finans kayıtlarından biri geçersiz.";
    if ((transaction.kind === "income" || transaction.kind === "credit") && !sponsorRef) return "Tahsilat ve platform kredisi için sponsor seçin.";
  }
  return null;
}
