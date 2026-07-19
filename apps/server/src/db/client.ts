import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "./schema.js";

export function createDatabase(filename: string) {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const sqlite = new Database(filename);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export type DatabaseBundle = ReturnType<typeof createDatabase>;
export type AppDatabase = DatabaseBundle["db"];

export function runMigrations(db: AppDatabase): void {
  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));
  migrate(db, { migrationsFolder });
}
