import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";

// Aurora DSQL connection pool. The connector signs a short-lived IAM token for
// every connection: locally it uses your AWS CLI login; on Amplify it uses the
// SSR compute role. The region is read from the endpoint hostname.

const cache = globalThis as typeof globalThis & { __docketDsqlPool?: AuroraDSQLPool };

export function db(): AuroraDSQLPool {
  const host = process.env.DSQL_ENDPOINT;
  if (!host) throw new Error("DSQL_ENDPOINT is not set.");
  return (cache.__docketDsqlPool ??= new AuroraDSQLPool({
    host,
    user: process.env.DSQL_USER ?? "admin",
    max: 4,
    idleTimeoutMillis: 30_000,
  }));
}
