import type { Db } from "./db.js";

type Currency = "TRY" | "USD";
type PublicationStatus = "planned" | "published" | "cancelled";
type TransactionKind = "income" | "expense" | "credit";

export type BusinessDataManifest = {
  version: 1;
  sponsors: Array<{
    id: string;
    slug: string;
    name: string;
    website_url: string | null;
    logo_url: string | null;
    notes: string;
  }>;
  publications: Array<{
    id: string;
    sponsor_id: string | null;
    platform: string;
    format: string;
    slot_id: string | null;
    title: string;
    planned_date: string;
    published_date: string | null;
    status: PublicationStatus;
    url: string | null;
    fee_minor: number;
    currency: Currency;
    notes: string;
  }>;
  transactions: Array<{
    id: string;
    sponsor_id: string | null;
    publication_id: string | null;
    kind: TransactionKind;
    amount_minor: number;
    currency: Currency;
    applied_minor: number | null;
    applied_currency: Currency | null;
    occurred_on: string;
    note: string;
  }>;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const currencies = new Set(["TRY", "USD"]);
const statuses = new Set(["planned", "published", "cancelled"]);
const kinds = new Set(["income", "expense", "credit"]);

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
}

function uniqueIds(rows: Array<{ id: string }>, label: string) {
  const ids = new Set<string>();
  for (const row of rows) {
    requiredText(row.id, `${label}.id`);
    if (ids.has(row.id)) throw new Error(`Duplicate ${label} id: ${row.id}`);
    ids.add(row.id);
  }
  return ids;
}

export function validateBusinessData(input: unknown, db: Db): asserts input is BusinessDataManifest {
  if (!input || typeof input !== "object") throw new Error("Manifest must be an object");
  const manifest = input as Partial<BusinessDataManifest>;
  if (manifest.version !== 1 || !Array.isArray(manifest.sponsors) || !Array.isArray(manifest.publications) || !Array.isArray(manifest.transactions))
    throw new Error("Unsupported or incomplete business data manifest");

  const sponsorIds = uniqueIds(manifest.sponsors, "sponsor");
  const publicationIds = uniqueIds(manifest.publications, "publication");
  uniqueIds(manifest.transactions, "transaction");
  const slugs = new Set<string>();
  const savedSlots = new Set((db.prepare("SELECT id FROM schedule_slots").all() as Array<{ id: string }>).map((row) => row.id));

  for (const sponsor of manifest.sponsors) {
    requiredText(sponsor.slug, "sponsor.slug");
    requiredText(sponsor.name, "sponsor.name");
    if (slugs.has(sponsor.slug)) throw new Error(`Duplicate sponsor slug: ${sponsor.slug}`);
    slugs.add(sponsor.slug);
  }

  for (const publication of manifest.publications) {
    requiredText(publication.title, "publication.title");
    requiredText(publication.platform, "publication.platform");
    requiredText(publication.format, "publication.format");
    if (publication.sponsor_id && !sponsorIds.has(publication.sponsor_id)) throw new Error(`Unknown sponsor on publication: ${publication.id}`);
    if (publication.slot_id && !savedSlots.has(publication.slot_id)) throw new Error(`Unknown schedule slot on publication: ${publication.id}`);
    if (!datePattern.test(publication.planned_date) || (publication.published_date !== null && !datePattern.test(publication.published_date)))
      throw new Error(`Invalid date on publication: ${publication.id}`);
    if (!statuses.has(publication.status) || !currencies.has(publication.currency) || !Number.isSafeInteger(publication.fee_minor) || publication.fee_minor < 0)
      throw new Error(`Invalid financial fields on publication: ${publication.id}`);
  }

  for (const transaction of manifest.transactions) {
    if (transaction.sponsor_id && !sponsorIds.has(transaction.sponsor_id)) throw new Error(`Unknown sponsor on transaction: ${transaction.id}`);
    if (transaction.publication_id && !publicationIds.has(transaction.publication_id)) throw new Error(`Unknown publication on transaction: ${transaction.id}`);
    if (!kinds.has(transaction.kind) || !currencies.has(transaction.currency) || !datePattern.test(transaction.occurred_on)
      || !Number.isSafeInteger(transaction.amount_minor) || transaction.amount_minor <= 0)
      throw new Error(`Invalid transaction: ${transaction.id}`);
    if (transaction.publication_id) {
      const publication = manifest.publications.find((row) => row.id === transaction.publication_id)!;
      if (publication.sponsor_id !== transaction.sponsor_id) throw new Error(`Sponsor mismatch on transaction: ${transaction.id}`);
      if (!Number.isSafeInteger(transaction.applied_minor) || (transaction.applied_minor ?? 0) <= 0 || transaction.applied_currency !== publication.currency)
        throw new Error(`Invalid publication allocation on transaction: ${transaction.id}`);
    } else if (transaction.applied_minor !== null || transaction.applied_currency !== null) {
      throw new Error(`Allocation without publication on transaction: ${transaction.id}`);
    }
  }
}

export function replaceBusinessData(db: Db, input: unknown) {
  validateBusinessData(input, db);
  const manifest = input;
  const preservedBefore = {
    users: (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n,
    sessions: (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n,
    slots: (db.prepare("SELECT COUNT(*) AS n FROM schedule_slots").get() as { n: number }).n,
    settings: (db.prepare("SELECT COUNT(*) AS n FROM workspace_settings").get() as { n: number }).n,
  };

  db.transaction(() => {
    db.exec("DELETE FROM transactions; DELETE FROM publications; DELETE FROM sponsors; DELETE FROM activity_log;");
    const addSponsor = db.prepare(`INSERT INTO sponsors
      (id, slug, name, website_url, logo_url, notes) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const sponsor of manifest.sponsors)
      addSponsor.run(sponsor.id, sponsor.slug, sponsor.name, sponsor.website_url, sponsor.logo_url, sponsor.notes);

    const addPublication = db.prepare(`INSERT INTO publications
      (id, sponsor_id, platform, format, slot_id, title, planned_date, published_date, status, url, fee_minor, currency, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const publication of manifest.publications)
      addPublication.run(publication.id, publication.sponsor_id, publication.platform, publication.format, publication.slot_id,
        publication.title, publication.planned_date, publication.published_date, publication.status, publication.url,
        publication.fee_minor, publication.currency, publication.notes);

    const addTransaction = db.prepare(`INSERT INTO transactions
      (id, sponsor_id, publication_id, kind, amount_minor, currency, applied_minor, applied_currency, occurred_on, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const transaction of manifest.transactions)
      addTransaction.run(transaction.id, transaction.sponsor_id, transaction.publication_id, transaction.kind,
        transaction.amount_minor, transaction.currency, transaction.applied_minor, transaction.applied_currency,
        transaction.occurred_on, transaction.note);
  })();

  const preservedAfter = {
    users: (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n,
    sessions: (db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n,
    slots: (db.prepare("SELECT COUNT(*) AS n FROM schedule_slots").get() as { n: number }).n,
    settings: (db.prepare("SELECT COUNT(*) AS n FROM workspace_settings").get() as { n: number }).n,
  };
  if (JSON.stringify(preservedBefore) !== JSON.stringify(preservedAfter)) throw new Error("Protected account or schedule records changed");
  if ((db.pragma("foreign_key_check") as unknown[]).length) throw new Error("Foreign key check failed after import");
  if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Database integrity check failed after import");
  return { sponsors: manifest.sponsors.length, publications: manifest.publications.length, transactions: manifest.transactions.length, preserved: preservedAfter };
}
