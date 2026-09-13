// Applies db/migrations/*.sql to Aurora DSQL, in filename order.
//
// DSQL allows one DDL statement per transaction, so each statement runs on its
// own (autocommit). Statements are separated by a line ending in ";".
// Applied files are recorded in schema_migrations; statements use IF NOT EXISTS
// so a file that failed partway can be re-run safely.
//
// Usage (from frontend/):
//   DSQL_ENDPOINT=<cluster-id>.dsql.us-west-2.on.aws node scripts/dsql-migrate.mjs
// Connects as the DSQL "admin" role with your current AWS credentials.

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuroraDSQLClient } from "@aws/aurora-dsql-node-postgres-connector";

const endpoint = process.env.DSQL_ENDPOINT;
if (!endpoint) {
  console.error("Set DSQL_ENDPOINT to the cluster endpoint, e.g. abc123.dsql.us-west-2.on.aws");
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new AuroraDSQLClient({ host: endpoint, user: process.env.DSQL_USER ?? "admin" });
await client.connect();

try {
  await client.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const applied = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file}`);
      continue;
    }
    const statements = readFileSync(join(dir, file), "utf8")
      .split(/;\s*(?:\r?\n|$)/)
      .map((chunk) =>
        chunk
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter(Boolean);

    console.log(`apply ${file} (${statements.length} statements)`);
    for (const [i, sql] of statements.entries()) {
      try {
        await client.query(sql);
      } catch (error) {
        console.error(`\nFailed at statement ${i + 1} of ${file}:\n${sql}\n`);
        throw error;
      }
    }
    await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
  }

  const pending = await client.query(
    "SELECT job_id, status FROM sys.jobs WHERE status NOT IN ('completed') ORDER BY job_id",
  ).catch(() => ({ rows: [] }));
  if (pending.rows.length) console.log(`index builds still running: ${pending.rows.length} (CREATE INDEX ASYNC)`);
  console.log("done");
} finally {
  await client.end();
}
