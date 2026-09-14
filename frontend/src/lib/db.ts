import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";
import type { PoolClient } from "pg";

// Aurora DSQL connection pool. The connector signs a short-lived IAM token for
// every connection: locally it uses your AWS CLI login; on Amplify it uses the
// SSR compute role. The region is read from the endpoint hostname.
//
// On Amplify the server runs on Lambda, which freezes between requests. The pool's
// idle and lifetime timers don't fire while frozen, so after a quiet spell it would
// hand out sockets that were already closed: queries then failed with "Connection
// terminated unexpectedly" or hung until the 30-second request limit. Connections
// past their idle or lifetime limit are therefore discarded when checked out, and
// timeouts turn any other hang into a quick error.

const IDLE_MS = 30_000;
// DSQL ends every connection after 60 minutes.
const MAX_AGE_MS = 50 * 60_000;

const releasedAt = new WeakMap<object, number>();
const openedAt = new WeakMap<object, number>();

/** True when a pooled connection sat unused past the idle limit or outlived its lifetime, so it may already be closed. */
export function isStale(now: number, released: number | undefined, opened: number | undefined): boolean {
  return (released !== undefined && now - released > IDLE_MS) || (opened !== undefined && now - opened > MAX_AGE_MS);
}

function createPool(host: string): AuroraDSQLPool {
  const pool = new AuroraDSQLPool({
    host,
    user: process.env.DSQL_USER ?? "admin",
    max: 4,
    idleTimeoutMillis: IDLE_MS,
    maxLifetimeSeconds: MAX_AGE_MS / 1000,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
    keepAlive: true,
  });
  // An idle connection that drops emits "error" on the pool, which would crash the server with no listener.
  pool.on("error", (error) => console.warn(`[docket] database connection dropped while idle: ${error.message}`));
  pool.on("connect", (client) => openedAt.set(client, Date.now()));
  pool.on("release", (_error, client) => releasedAt.set(client, Date.now()));

  const acquire = pool.connect.bind(pool);
  async function freshClient(): Promise<PoolClient> {
    for (;;) {
      const client = await acquire();
      if (!isStale(Date.now(), releasedAt.get(client), openedAt.get(client))) return client;
      // Removes it from the pool; the next pass takes another idle connection or opens a new one.
      client.release(true);
    }
  }

  // pool.query() calls connect() with a callback; the connector's transaction() awaits it.
  type ConnectCallback = (error: Error | undefined, client?: PoolClient, done?: (release?: boolean | Error) => void) => void;
  pool.connect = ((callback?: ConnectCallback) => {
    const client = freshClient();
    if (!callback) return client;
    client.then(
      (c) => callback(undefined, c, c.release),
      (error: Error) => callback(error, undefined, () => {}),
    );
  }) as unknown as AuroraDSQLPool["connect"];
  return pool;
}

const cache = globalThis as typeof globalThis & { __docketDsqlPool?: AuroraDSQLPool };

export function db(): AuroraDSQLPool {
  const host = process.env.DSQL_ENDPOINT;
  if (!host) throw new Error("DSQL_ENDPOINT is not set.");
  return (cache.__docketDsqlPool ??= createPool(host));
}
