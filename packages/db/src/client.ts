import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
let client: ReturnType<typeof postgres> | undefined;
let database: Database | undefined;

/** No connection or environment lookup occurs until the first call. */
export function getDb(): Database {
  if (database) return database;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  client = postgres(url, { max: 10 });
  database = drizzle(client, { schema });
  return database;
}

/** For CLI cleanup and graceful server shutdown. */
export async function closeDb(): Promise<void> {
  if (client) await client.end();
  client = undefined;
  database = undefined;
}
