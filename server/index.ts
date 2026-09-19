import { serve } from "@hono/node-server";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const db = openDb(undefined, { createIfMissing: process.env.NODE_ENV !== "production" });
const port = Number(process.env.PORT || 3001);
const hostname = process.env.NODE_ENV === "production" ? (process.env.HOST || "0.0.0.0") : "127.0.0.1";
const server = serve({ fetch: createApp(db).fetch, port, hostname });
console.log(`Spawn listening on ${hostname}:${port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
