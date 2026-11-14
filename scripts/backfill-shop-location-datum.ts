/**
 * Backfill `location.coordinateSystem` on stored shop documents.
 *
 * Shop coordinates are persisted in the datum their territory stores
 * coordinates in (GCJ02 on the mainland and in the SARs, WGS84 for Taiwan and
 * abroad), but older documents never recorded which datum their numbers are
 * in — every read re-derived it from the region chain instead. The schema now
 * requires the datum on `shopLocationSchema`, and a document missing the field
 * fails shop output validation once that schema is live, so this stamps every
 * stored location with what the location service resolves for its point.
 *
 * One-time: once every document carries the field the script has nothing left
 * to do. It stays idempotent — it only touches documents where the field is
 * *absent*, so a re-run on a completed database is a no-op, and a datum that
 * was stamped by a previous run is never overwritten.
 *
 * Resolution failures under load are transient (the service queues, answering
 * timeouts or 503), so each point retries with backoff, and whatever is still
 * unresolved goes through gentler retry sweeps before the run gives up on it
 * and reports it. A re-run always picks up anything left.
 *
 * The datum is resolved per point from the location service (POST /geo/resolve,
 * the same territory rule `resolveTerritoryDatum` follows at write time). As a
 * read-only audit it is also compared against the datum the stored region chain
 * implies; a disagreement means the chain and the point tell different stories
 * (e.g. a chain edited without re-picking the point) — that is reported as a
 * warning, never guessed away.
 *
 * Run this BEFORE deploying the schema change: documents missing the field
 * fail shop output validation once the new schema is live.
 *
 * Dry run by default; pass `--apply` to write.
 *
 *   pnpm exec tsx ./scripts/backfill-shop-location-datum.ts
 *   pnpm exec tsx ./scripts/backfill-shop-location-datum.ts --apply
 *
 * Flags: `--concurrency <n>` parallel /geo/resolve calls (default 8) and
 * `--limit <n>` to process only the first n matching documents (smoke runs).
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: process.cwd() + '/.env' });

const APPLY = process.argv.includes('--apply');

/** The value following a `--flag`, when present. */
const argValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const CONCURRENCY = Math.max(1, Number.parseInt(argValue('--concurrency') ?? '', 10) || 8);
const LIMIT = (() => {
  const parsed = Number.parseInt(argValue('--limit') ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
})();

/** Extra, gentler passes over whatever failed the previous pass. */
const RETRY_SWEEPS = 3;
const RETRY_CONCURRENCY = Math.max(1, Math.ceil(CONCURRENCY / 4));
/** Resolve attempts per document per sweep, with backoff between them. */
const ATTEMPTS = 4;

type CoordinateSystem = 'WGS84' | 'GCJ02';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set');
  process.exit(1);
}

const geoUrl = (process.env.UNIFIED_GEO_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
const geoSecret = process.env.UNIFIED_GEO_API_SECRET;
if (!geoSecret) {
  console.error('UNIFIED_GEO_API_SECRET is not set');
  process.exit(1);
}

/**
 * Resolve the territory datum for a point — the same /geo/resolve call and
 * territory rule the write path's `resolveTerritoryDatum` follows. The stored
 * coordinates are sent as WGS84: their true datum is what is being looked up,
 * and the ~500 m GCJ02 offset cannot flip the answer, because GCJ02 and WGS84
 * territories only adjoin across water.
 */
async function resolveTerritoryDatum(
  longitude: number,
  latitude: number
): Promise<CoordinateSystem> {
  const response = await fetch(`${geoUrl}/geo/resolve`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${geoSecret}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ coordinate: { longitude, latitude, coordinateSystem: 'WGS84' } }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`/geo/resolve failed with ${response.status}`);
  }
  const payload = (await response.json()) as {
    success?: boolean;
    territory?: { datum?: CoordinateSystem };
  };
  if (payload.success !== true || !payload.territory?.datum) {
    throw new Error('/geo/resolve returned an invalid response');
  }
  return payload.territory.datum;
}

/**
 * Resolve with retries. The failures this script sees are transient — the
 * service queues under load and answers timeouts or 503 — so a short backoff
 * per attempt is what turns the tail into successes. Documents with unusable
 * coordinates never reach this; they fail deterministically.
 */
async function resolveTerritoryDatumWithRetry(
  longitude: number,
  latitude: number
): Promise<CoordinateSystem> {
  let lastCause: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await resolveTerritoryDatum(longitude, latitude);
    } catch (cause) {
      lastCause = cause;
      if (attempt < ATTEMPTS) {
        // Exponential backoff with jitter, so parallel workers never stampede
        // the service on the same beat.
        await new Promise((resolve) =>
          setTimeout(resolve, 2 ** (attempt - 1) * 1000 + Math.random() * 500)
        );
      }
    }
  }
  throw lastCause;
}

/**
 * The datum a region chain implies — audit only, never written. It mirrors the
 * territory rule in aggregate (mainland and SARs GCJ02, Taiwan and abroad
 * WGS84); a mismatch with the resolved datum flags a chain that does not
 * describe the stored point.
 */
function regionChainDatum(region: unknown): CoordinateSystem | undefined {
  if (!Array.isArray(region)) return undefined;
  const ids = region.filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) return undefined;
  if (ids.some((id) => id === 'TW' || id.startsWith('CN-71'))) return 'WGS84';
  return ids.some((id) => id === 'CN' || id === 'HK' || id === 'MO') ? 'GCJ02' : 'WGS84';
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
await client.connect();
try {
  const db = client.db(process.env.MONGODB_DB || process.env.DB_NAME || undefined);
  const shops = db.collection('shops');
  const filter = {
    'location.coordinates': { $exists: true },
    'location.coordinateSystem': { $exists: false }
  };

  const affected = await shops.countDocuments(filter);
  console.log(`database: ${db.databaseName}  mode: ${APPLY ? 'APPLY' : 'dry run'}`);
  console.log(
    `shops.location.coordinateSystem: ${affected} document(s) to stamp` +
      (LIMIT ? ` (processing the first ${LIMIT})` : '') +
      `\n`
  );

  let stamped = 0;
  let mismatched = 0;
  let unusable = 0;

  const cursor = shops.find(filter, { projection: { _id: 1, location: 1, address: 1 } });
  if (LIMIT) cursor.limit(LIMIT);
  const docs = await cursor.toArray();

  /**
   * One document: resolve with retries, audit, stamp. A document that still
   * fails lands in the sink for the next sweep to retry; unusable coordinates
   * are reported and never retried — they fail deterministically.
   */
  const processDoc = async (doc: (typeof docs)[number], sink: typeof docs): Promise<void> => {
    const location = doc.location as { coordinates?: number[] } | undefined;
    const [longitude, latitude] = location?.coordinates ?? [];
    if (typeof longitude !== 'number' || typeof latitude !== 'number') {
      console.warn(`  shop ${doc._id}: location has no usable coordinates — skipped`);
      unusable++;
      return;
    }

    try {
      const datum = await resolveTerritoryDatumWithRetry(longitude, latitude);
      const implied = regionChainDatum((doc.address as { region?: unknown } | undefined)?.region);
      const note = implied && implied !== datum ? `  (region chain implies ${implied}!)` : '';
      if (implied && implied !== datum) mismatched++;

      console.log(`  shop ${doc._id}: ${longitude}, ${latitude} -> ${datum}${note}`);
      if (APPLY) {
        // Re-check the guard in the update so a concurrent writer that stamps
        // the field mid-run is never overwritten.
        await shops.updateOne(
          { _id: doc._id, 'location.coordinateSystem': { $exists: false } },
          { $set: { 'location.coordinateSystem': datum } }
        );
      }
      stamped++;
    } catch (cause) {
      console.warn(`  shop ${doc._id}: datum resolution failed —`, cause);
      sink.push(doc);
    }
  };

  /**
   * Resolve a list in parallel — one /geo/resolve per document, and the
   * service is the same one the app calls per request. Workers claim the
   * next index synchronously, so the pool needs no coordination beyond that.
   */
  const runPool = async (list: typeof docs, concurrency: number): Promise<typeof docs> => {
    const sink: typeof docs = [];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < list.length) {
        await processDoc(list[next++], sink);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    return sink;
  };

  // Main pass, then gentler sweeps over whatever is still unresolved.
  let pending = await runPool(docs, CONCURRENCY);
  for (let sweep = 1; pending.length > 0 && sweep <= RETRY_SWEEPS; sweep++) {
    console.log(
      `\nretry sweep ${sweep}/${RETRY_SWEEPS}: ${pending.length} unresolved — retrying at concurrency ${RETRY_CONCURRENCY}`
    );
    pending = await runPool(pending, RETRY_CONCURRENCY);
  }

  console.log(
    `\n${APPLY ? `applied; ${stamped} document(s) stamped.` : 'dry run — nothing written. Re-run with --apply.'}`
  );
  if (mismatched > 0) {
    console.log(
      `audit: ${mismatched} document(s) where the region chain implies a different datum — review those shops.`
    );
  }
  if (unusable > 0) {
    console.log(
      `${unusable} document(s) have no usable coordinates — fix the data; re-runs skip them.`
    );
  }
  if (pending.length > 0) {
    console.log(
      `${pending.length} document(s) still unresolved after ${RETRY_SWEEPS} sweep(s) — re-run to pick them up.`
    );
    if (APPLY) process.exitCode = 1;
  }
} finally {
  await client.close();
}
