// Loads reference data into Aurora DSQL: all 28 official Fremont neighborhood
// areas and the sample neighborhood groups (is_sample = true). Safe to re-run.
//
// Usage (from frontend/, Node 22.18+ runs TypeScript directly):
//   DSQL_ENDPOINT=<cluster>.dsql.us-west-2.on.aws node scripts/dsql-seed.ts

import { AuroraDSQLClient } from "@aws/aurora-dsql-node-postgres-connector";
import { GROUP_SEEDS } from "../src/data/fixtures.ts";
import neighborhoods from "../src/data/fremont-neighborhoods.json" with { type: "json" };

const endpoint = process.env.DSQL_ENDPOINT;
if (!endpoint) {
  console.error("Set DSQL_ENDPOINT to the cluster endpoint, e.g. abc123.dsql.us-west-2.on.aws");
  process.exit(1);
}

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const client = new AuroraDSQLClient({ host: endpoint, user: process.env.DSQL_USER ?? "admin" });
await client.connect();

try {
  await client.transaction(async (tx) => {
    for (const n of neighborhoods) {
      await tx.query(
        `INSERT INTO neighborhoods (slug, name, boundary, centroid, area_km2)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, boundary = EXCLUDED.boundary, centroid = EXCLUDED.centroid, area_km2 = EXCLUDED.area_km2`,
        [n.slug, n.name, JSON.stringify(n.polygon), JSON.stringify(n.centroid), n.areaKm2],
      );
    }

    for (const g of GROUP_SEEDS) {
      await tx.query(
        `INSERT INTO groups (slug, name, neighborhood_slug, description, watchlist, meets, founded_on, is_sample)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, true)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, neighborhood_slug = EXCLUDED.neighborhood_slug, description = EXCLUDED.description,
           watchlist = EXCLUDED.watchlist, meets = EXCLUDED.meets, founded_on = EXCLUDED.founded_on`,
        [g.slug, g.name, slugOf(g.district), g.description, JSON.stringify(g.watchlist), g.meets, g.foundedOn],
      );
    }
  });

  const { rows } = await client.query(
    "SELECT (SELECT count(*) FROM neighborhoods)::int AS neighborhoods, (SELECT count(*) FROM groups)::int AS groups",
  );
  console.log("seeded:", rows[0]);
} finally {
  await client.end();
}
