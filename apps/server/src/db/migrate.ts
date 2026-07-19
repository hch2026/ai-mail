import { readConfig } from "../config/env.js";
import { createDatabase, runMigrations } from "./client.js";

const config = readConfig();
const bundle = createDatabase(config.DATABASE_URL);
try {
  runMigrations(bundle.db);
} finally {
  bundle.sqlite.close();
}
