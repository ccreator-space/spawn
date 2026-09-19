import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { dataDir } from "./db.js";

const backupDir = process.argv[2] || join(dataDir, "backups");
const source = join(dataDir, "sponsor.db");
if (!existsSync(source)) throw new Error(`Database is missing: ${source}`);
mkdirSync(backupDir, { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });
if (db.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Database integrity check failed; backup aborted.");
const destination = join(backupDir, `sponsor-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
await db.backup(destination);
db.close();
const verified = new Database(destination, { readonly: true, fileMustExist: true });
if (verified.pragma("integrity_check", { simple: true }) !== "ok") throw new Error("Backup integrity check failed.");
verified.close();
console.log(destination);
