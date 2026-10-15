import { withDatabase } from "@cryptum/db";

export async function withDatabaseRequest<T>(fn: () => Promise<T>): Promise<T> {
  if (process.env.CRYPTUM_DATABASE_MODE !== "hyperdrive") return fn();
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = getCloudflareContext();
  const hyperdrive = (env as unknown as { HYPERDRIVE: { connectionString: string } }).HYPERDRIVE;
  if (!hyperdrive?.connectionString) throw new Error("Hyperdrive binding is required");
  return withDatabase(hyperdrive.connectionString, fn);
}
