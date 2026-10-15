import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;
type DatabaseState = {
  url?: string;
  client?: ReturnType<typeof postgres>;
  database?: Database;
};
const requests = new AsyncLocalStorage<DatabaseState>();
const local: DatabaseState = {};

/** No connection or environment lookup occurs until the first call. */
export function getDb(): Database {
  const state = requests.getStore() ?? local;
  if (state.database) return state.database;
  const url = state.url ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  state.client = postgres(url, {
    max: 5,
    connect_timeout: 10,
    // Hyperdrive owns pooling and prepared statements across Worker requests.
    ...(state.url ? { prepare: false } : {}),
  });
  state.database = drizzle(state.client, { schema });
  return state.database;
}

/** Keep Worker sockets inside the request that created them. */
export async function withDatabase<T>(url: string, fn: () => Promise<T>): Promise<T> {
  return requests.run({ url }, async () => {
    try { return await fn(); }
    finally { await closeDb(); }
  });
}

/** For request cleanup, CLI cleanup and graceful server shutdown. */
export async function closeDb(): Promise<void> {
  const state = requests.getStore() ?? local;
  if (state.client) await state.client.end({ timeout: 1 });
  state.client = undefined;
  state.database = undefined;
}
