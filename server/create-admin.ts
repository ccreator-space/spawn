import { randomUUID } from "node:crypto";
import { openDb } from "./db.js";
import { hashPassword } from "./auth.js";

function hiddenPrompt(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("Interactive terminal required"));
    process.stdout.write(label);
    let input = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(input);
          return;
        }
        if (char === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.off("data", onData);
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\u007f") input = input.slice(0, -1);
        else input += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("Usage: pnpm admin:create you@example.com");
  process.exit(1);
}
const db = openDb();
if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
  console.error("This email already exists.");
  process.exit(1);
}
const password = await hiddenPrompt("Password (at least 12 characters): ");
if (password.length < 12) {
  console.error("Password too short.");
  process.exit(1);
}
db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(randomUUID(), email, hashPassword(password));
db.close();
console.log("Admin created.");
