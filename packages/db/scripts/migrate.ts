import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import "./env.js";
import { getDb, closeDb } from "../src/index.js";

try {
  await migrate(getDb(), {
    migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
  });
  console.log("Database migrations applied.");
} finally {
  await closeDb();
}
