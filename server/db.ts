import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

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
  if (version > 1) throw new Error(`Database schema ${version} is newer than this app`);
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
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_publications_date ON publications(planned_date, platform);
    CREATE INDEX IF NOT EXISTS idx_publications_sponsor ON publications(sponsor_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_slot ON publications(planned_date, slot_id)
      WHERE slot_id IS NOT NULL AND status != 'cancelled';
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, sponsor_id TEXT REFERENCES sponsors(id),
      publication_id TEXT REFERENCES publications(id),
      kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
      amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
      currency TEXT NOT NULL CHECK(currency IN ('TRY','USD')),
      occurred_on TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_sponsor ON transactions(sponsor_id, occurred_on);
    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id),
      entity TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  if (version === 0) db.pragma("user_version = 1");
  const initial = [
    ["hostinger", "Hostinger", "https://hostinger.com/poyraz", "/sponsors/hostinger.png"],
    ["testsprite", "TestSprite", "https://www.testsprite.com/?via=poyraz", "/sponsors/testsprite.png"],
    ["minimax", "MiniMax", "https://platform.minimax.io/subscribe/coding-plan?code=7aH9b0Ya7c&source=link", "/sponsors/minimax.png"],
    ["higgsfield", "Higgsfield", "https://higgsfield.ai/s/higgsfield-mcp-3-0-yt-poyrazavsever-lLvqMw", "/sponsors/higgsfield.png"],
    ["hosting-dunyam", "Hosting Dünyam", "https://hostingdunyam.com", "/sponsors/hosting-dunyam.png"],
    ["watchman-tower", "Watchman Tower", "https://www.watchmantower.com/", "/sponsors/watchmantower.png"],
    ["aisa-one", "AIsa One", null, "/sponsors/aisa-one.svg"],
    ["atoms", "Atoms.dev", "https://atoms.dev", "/sponsors/atoms.png"],
    ["abacus", "Abacus.ai", "https://abacus.ai", "/sponsors/abacus.png"],
  ];
  const insert = db.prepare("INSERT OR IGNORE INTO sponsors (id, slug, name, website_url, logo_url) VALUES (?, ?, ?, ?, ?)");
  for (const [slug, name, website, logo] of initial) insert.run(slug, slug, name, website, logo);
  })();
}
