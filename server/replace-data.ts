import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import { replaceBusinessData } from "./business-data.js";
import { dataDir, openDb } from "./db.js";

const sourceFile = process.argv[2];
if (!sourceFile) throw new Error("Usage: pnpm data:replace -- /path/to/business-data.json");
if (!existsSync(sourceFile)) throw new Error(`Manifest is missing: ${sourceFile}`);

const manifest = JSON.parse(readFileSync(sourceFile, "utf8")) as unknown;
const backupDir = join(dataDir, "backups");
mkdirSync(backupDir, { recursive: true });
const databaseFile = join(dataDir, "sponsor.db");
const db = openDb(databaseFile, { createIfMissing: false });
const backupFile = join(backupDir, `before-replace-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);

try {
  await db.backup(backupFile);
  const verified = new Database(backupFile, { readonly: true, fileMustExist: true });
  if (verified.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Backup integrity check failed");
  verified.close();
  const result = replaceBusinessData(db, manifest);
  console.log(JSON.stringify({ ok: true, source: basename(sourceFile), backup: backupFile, ...result }, null, 2));
} finally {
  db.close();
}
