import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { WEEKLY_SLOTS } from "./schedule.js";

export const dataDir = process.env.DATA_DIR || join(process.cwd(), "data");

export function openDb(file = join(dataDir, "sponsor.db"), options: { createIfMissing?: boolean } = {}) {
  if (file !== ":memory:" && options.createIfMissing === false && !existsSync(file))
    throw new Error(`Database is missing: ${file}. Restore the data volume or initialize the first administrator.`);
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file, { fileMustExist: options.createIfMissing === false && file !== ":memory:" });
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    migrate(db);
    return db;
  } catch (error) { db.close(); throw error; }
}

export type Db = ReturnType<typeof openDb>;

function migrate(db: Database.Database) {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > 5) throw new Error(`Database schema ${version} is newer than this app`);
  db.transaction(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sponsors (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      website_url TEXT, logo_url TEXT, notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY, sponsor_id TEXT REFERENCES sponsors(id),
      platform TEXT NOT NULL, format TEXT NOT NULL, slot_id TEXT,
      title TEXT NOT NULL, planned_date TEXT NOT NULL, published_date TEXT,
      status TEXT NOT NULL CHECK(status IN ('planned','published','cancelled')),
      url TEXT, fee_minor INTEGER NOT NULL DEFAULT 0 CHECK(fee_minor >= 0),
      currency TEXT NOT NULL CHECK(currency IN ('TRY','USD')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_publications_date ON publications(planned_date, platform);
    CREATE INDEX IF NOT EXISTS idx_publications_sponsor ON publications(sponsor_id);
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, sponsor_id TEXT REFERENCES sponsors(id),
      publication_id TEXT REFERENCES publications(id),
      kind TEXT NOT NULL CHECK(kind IN ('income','expense','credit')),
      amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
      currency TEXT NOT NULL CHECK(currency IN ('TRY','USD')),
      applied_minor INTEGER CHECK(applied_minor IS NULL OR applied_minor >= 0),
      applied_currency TEXT CHECK(applied_currency IS NULL OR applied_currency IN ('TRY','USD')),
      occurred_on TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_sponsor ON transactions(sponsor_id, occurred_on);
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
      entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workspace_settings (
      id INTEGER PRIMARY KEY CHECK(id = 1), workspace_name TEXT NOT NULL DEFAULT 'Spawn',
      onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK(onboarding_completed IN (0, 1)),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS schedule_slots (
      id TEXT PRIMARY KEY, weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
      platform TEXT NOT NULL, format TEXT NOT NULL, label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_slots_day ON schedule_slots(weekday, sort_order);
  `);
  if (version === 1) {
    db.exec(`
      DROP INDEX IF EXISTS idx_transactions_sponsor;
      ALTER TABLE transactions RENAME TO transactions_v1;
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY, sponsor_id TEXT REFERENCES sponsors(id),
        publication_id TEXT REFERENCES publications(id),
        kind TEXT NOT NULL CHECK(kind IN ('income','expense','credit')),
        amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
        currency TEXT NOT NULL CHECK(currency IN ('TRY','USD')),
        occurred_on TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO transactions (id, sponsor_id, publication_id, kind, amount_minor, currency, occurred_on, note, created_at)
        SELECT id, sponsor_id, publication_id, kind, amount_minor, currency, occurred_on, note, created_at FROM transactions_v1;
      DROP TABLE transactions_v1;
      CREATE INDEX idx_transactions_sponsor ON transactions(sponsor_id, occurred_on);
    `);
  }
  db.prepare("INSERT OR IGNORE INTO workspace_settings (id) VALUES (1)").run();
  if (version > 0 && version < 3) {
    const insertSlot = db.prepare("INSERT OR IGNORE INTO schedule_slots (id, weekday, platform, format, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
    WEEKLY_SLOTS.forEach((slot, index) => insertSlot.run(slot.id, slot.weekday, slot.platform, slot.format, slot.label, index));
    db.prepare("UPDATE workspace_settings SET onboarding_completed = 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1").run();
  }
  const sponsorColumns = db.prepare("PRAGMA table_info(sponsors)").all() as Array<{ name: string }>;
  if (!sponsorColumns.some((column) => column.name === "deleted_at")) db.exec("ALTER TABLE sponsors ADD COLUMN deleted_at TEXT");
  const publicationColumns = db.prepare("PRAGMA table_info(publications)").all() as Array<{ name: string }>;
  if (!publicationColumns.some((column) => column.name === "deleted_at")) db.exec("ALTER TABLE publications ADD COLUMN deleted_at TEXT");
  const transactionColumns = db.prepare("PRAGMA table_info(transactions)").all() as Array<{ name: string }>;
  if (!transactionColumns.some((column) => column.name === "applied_minor")) db.exec("ALTER TABLE transactions ADD COLUMN applied_minor INTEGER CHECK(applied_minor IS NULL OR applied_minor >= 0)");
  if (!transactionColumns.some((column) => column.name === "applied_currency")) db.exec("ALTER TABLE transactions ADD COLUMN applied_currency TEXT CHECK(applied_currency IS NULL OR applied_currency IN ('TRY','USD'))");
  if (version < 5) db.exec(`
    UPDATE transactions SET applied_minor = amount_minor, applied_currency = currency
      WHERE publication_id IS NOT NULL AND kind IN ('income', 'credit') AND applied_minor IS NULL;
  `);
  db.exec(`
    DROP INDEX IF EXISTS idx_publications_slot;
    CREATE UNIQUE INDEX idx_publications_slot ON publications(planned_date, slot_id)
      WHERE slot_id IS NOT NULL AND status != 'cancelled' AND deleted_at IS NULL;
  `);
  if (version < 5) db.pragma("user_version = 5");
  })();
}
