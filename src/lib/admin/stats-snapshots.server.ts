/**
 * Admin dashboard stock snapshots.
 *
 * Each capture stores per-metric totals plus exact added/removed counts derived
 * from a rolling 64-bit ID-hash set (diffed against the previous capture). The
 * hash set is a single overwritten document, so history is cheap: only the
 * small snapshot records are kept long-term, and period totals (e.g. "this
 * week") are sums of the daily diffs.
 *
 * `universities` is count-only (manual backend maintenance, no creation date,
 * no meaningful churn signal) — it is snapshotted for totals/trends but never
 * hashed or diffed.
 */
import { createHash } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import mongo from '$lib/db/index.server';

export const STATS_SNAPSHOT_COLLECTION = 'admin_stats_snapshots';
export const STATS_IDSET_COLLECTION = 'admin_stats_idset';

export const STATS_SCOPE_SITE = 'site';

/** Metrics snapshotted as totals only (no hash-diff add/remove). */
export const COUNT_ONLY_METRICS = ['universities'] as const;

/** Metrics with exact add/remove via rolling ID-hash diff. */
export const DIFF_METRICS = [
  'users',
  'universityChangelogs',
  'clubs',
  'posts',
  'shops',
  'shopChangelogs',
  'machines',
  'images',
  'invites',
  'joinRequests',
  'oauthClients',
  'shopDeleteRequests'
] as const;

export type CountOnlyMetric = (typeof COUNT_ONLY_METRICS)[number];
export type DiffMetric = (typeof DIFF_METRICS)[number];
export type StatsMetric = DiffMetric | CountOnlyMetric;

export const ALL_METRICS: readonly StatsMetric[] = [...DIFF_METRICS, ...COUNT_ONLY_METRICS];

export const isDiffMetric = (metric: StatsMetric): metric is DiffMetric =>
  (DIFF_METRICS as readonly string[]).includes(metric);

interface MetricSource {
  collection: string;
  /** Business id field; falls back to `_id` when missing. */
  idField: string;
  filter: Record<string, unknown>;
}

export const METRIC_SOURCES: Record<StatsMetric, MetricSource> = {
  users: { collection: 'users', idField: 'id', filter: {} },
  universities: { collection: 'universities', idField: 'id', filter: {} },
  universityChangelogs: {
    collection: 'changelog',
    idField: 'id',
    filter: { type: 'university' }
  },
  clubs: { collection: 'clubs', idField: 'id', filter: {} },
  posts: { collection: 'posts', idField: 'id', filter: {} },
  shops: { collection: 'shops', idField: 'id', filter: {} },
  shopChangelogs: { collection: 'shop_changelog', idField: 'id', filter: {} },
  machines: { collection: 'machines', idField: 'id', filter: {} },
  images: { collection: 'images', idField: 'id', filter: {} },
  invites: { collection: 'invite_links', idField: 'id', filter: {} },
  joinRequests: { collection: 'join_requests', idField: 'id', filter: {} },
  oauthClients: { collection: 'oauth_clients', idField: 'clientId', filter: {} },
  shopDeleteRequests: { collection: 'shop_delete_requests', idField: 'id', filter: {} }
};

export type MetricCounts = Record<StatsMetric, number>;
export type MetricDeltas = Record<DiffMetric, number | null>;

export interface AdminStatsSnapshot {
  _id: string;
  scope: string;
  date: string;
  at: Date;
  prevDate: string | null;
  counts: MetricCounts;
  added: MetricDeltas;
  removed: MetricDeltas;
}

export interface AdminStatsIdSet {
  _id: string;
  date: string;
  hashes: Partial<Record<DiffMetric, Buffer>>;
}

export interface CaptureStatsSnapshotResult {
  snapshot: AdminStatsSnapshot;
  baseline: boolean;
}

export interface PeriodDelta {
  added: number | null;
  removed: number | null;
  /** added - removed when both sides exist (gross churn, not inventory net). */
  net: number | null;
}

export interface SnapshotSeriesPoint {
  date: string;
  counts: Partial<MetricCounts>;
}

export interface AdminStatsSnapshotView {
  /** Latest capture (null when history has not started). */
  latest: AdminStatsSnapshot | null;
  /** Ascending snapshot series covering `days` days (or all available). */
  series: SnapshotSeriesPoint[];
  /** Sum of daily diffs over the trailing window ending at the latest capture. */
  period: { days: number; delta: Record<DiffMetric, PeriodDelta> };
  /** Latest capture's own daily diffs (null when baseline / no previous). */
  day: {
    capturedAt: Date | null;
    prevDate: string | null;
    delta: Record<DiffMetric, PeriodDelta>;
  };
}

const emptyDeltas = (): MetricDeltas =>
  Object.fromEntries(DIFF_METRICS.map((metric) => [metric, null])) as MetricDeltas;

const emptyCounts = (): MetricCounts =>
  Object.fromEntries(ALL_METRICS.map((metric) => [metric, 0])) as MetricCounts;

export const snapshotKey = (scope: string, date: string) => `${scope}|${date}`;
export const idsetKey = (scope: string) => scope;

/** UTC calendar date (YYYY-MM-DD). */
export const toUtcDateKey = (at: Date = new Date()): string => at.toISOString().slice(0, 10);

const hashId = (id: string): Buffer =>
  createHash('sha256').update(id, 'utf8').digest().subarray(0, 8);

const bufferToHashSet = (value: Buffer | Uint8Array | undefined | null): Set<string> => {
  const set = new Set<string>();
  if (!value || value.length === 0) return set;
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  for (let offset = 0; offset + 8 <= buf.length; offset += 8) {
    set.add(buf.subarray(offset, offset + 8).toString('hex'));
  }
  return set;
};

const hashesToBuffer = (hashes: Iterable<Buffer>): Buffer => Buffer.concat([...hashes]);

const readIdSetHashes = (
  idset: AdminStatsIdSet | null | undefined,
  metric: DiffMetric
): Set<string> => bufferToHashSet(idset?.hashes?.[metric]);

const diffHashSets = (
  previous: Set<string>,
  current: Set<string>
): { added: number; removed: number } => {
  let added = 0;
  let removed = 0;
  for (const id of current) {
    if (!previous.has(id)) added += 1;
  }
  for (const id of previous) {
    if (!current.has(id)) removed += 1;
  }
  return { added, removed };
};

const normalizeSnapshot = (raw: unknown): AdminStatsSnapshot | null => {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Partial<AdminStatsSnapshot> & { _id: string };
  if (!doc._id || !doc.date) return null;

  const counts = emptyCounts();
  for (const metric of ALL_METRICS) {
    const value = doc.counts?.[metric];
    counts[metric] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  const added = emptyDeltas();
  const removed = emptyDeltas();
  for (const metric of DIFF_METRICS) {
    const addValue = doc.added?.[metric];
    const removeValue = doc.removed?.[metric];
    added[metric] = typeof addValue === 'number' && Number.isFinite(addValue) ? addValue : null;
    removed[metric] =
      typeof removeValue === 'number' && Number.isFinite(removeValue) ? removeValue : null;
  }

  return {
    _id: doc._id,
    scope: doc.scope ?? STATS_SCOPE_SITE,
    date: doc.date,
    at: doc.at instanceof Date ? doc.at : new Date(doc.at ?? doc.date),
    prevDate: doc.prevDate ?? null,
    counts,
    added,
    removed
  };
};

interface MetricScan {
  count: number;
  hashes: Buffer | null;
}

const scanMetric = async (
  db: Db,
  metric: StatsMetric,
  options: { includeHashes: boolean }
): Promise<MetricScan> => {
  const source = METRIC_SOURCES[metric];
  const projection: Record<string, 1> = { _id: 1 };
  if (source.idField !== '_id') {
    projection[source.idField] = 1;
  }

  const cursor = db
    .collection(source.collection)
    .find(source.filter, { projection })
    .sort({ _id: 1 });

  let count = 0;
  const chunks: Buffer[] = [];

  for await (const doc of cursor) {
    count += 1;
    if (!options.includeHashes) continue;
    const raw = (doc as Record<string, unknown>)[source.idField];
    const id = raw != null && raw !== '' ? String(raw) : String(doc._id);
    chunks.push(hashId(id));
  }

  return {
    count,
    hashes: options.includeHashes ? hashesToBuffer(chunks) : null
  };
};

/**
 * Capture today's stock snapshot and refresh the rolling ID-hash set.
 *
 * One logical bucket per UTC date. Re-running the same day refreshes counts and
 * hashes, and accumulates any further churn into that day's added/removed so
 * period sums still cover the whole day.
 */
export const captureAdminStatsSnapshot = async (
  client: MongoClient = mongo,
  options: { scope?: string; now?: Date } = {}
): Promise<CaptureStatsSnapshotResult> => {
  const db = client.db();
  const scope = options.scope ?? STATS_SCOPE_SITE;
  const now = options.now ?? new Date();
  const date = toUtcDateKey(now);

  const idsetCollection = db.collection<AdminStatsIdSet>(STATS_IDSET_COLLECTION);
  const snapshotCollection = db.collection<AdminStatsSnapshot>(STATS_SNAPSHOT_COLLECTION);

  const [previousIdset, existingSnapshot] = await Promise.all([
    idsetCollection.findOne({ _id: idsetKey(scope) }),
    snapshotCollection.findOne({ _id: snapshotKey(scope, date) })
  ]);

  const priorNormalized = normalizeSnapshot(existingSnapshot);
  const counts = emptyCounts();
  const added = emptyDeltas();
  const removed = emptyDeltas();
  const nextHashes: Partial<Record<DiffMetric, Buffer>> = {};
  const baseline = !previousIdset;

  await Promise.all(
    ALL_METRICS.map(async (metric) => {
      const includeHashes = isDiffMetric(metric);
      const scan = await scanMetric(db, metric, { includeHashes });
      counts[metric] = scan.count;

      if (!includeHashes || !scan.hashes) return;

      nextHashes[metric] = scan.hashes;

      if (!previousIdset) {
        added[metric] = null;
        removed[metric] = null;
        return;
      }

      const delta = diffHashSets(
        readIdSetHashes(previousIdset, metric),
        bufferToHashSet(scan.hashes)
      );

      if (previousIdset.date !== date) {
        added[metric] = delta.added;
        removed[metric] = delta.removed;
        return;
      }

      // Same-day re-run: fold further churn into the existing day bucket.
      const prevAdded = priorNormalized?.added[metric];
      const prevRemoved = priorNormalized?.removed[metric];
      if (prevAdded == null && prevRemoved == null) {
        added[metric] = delta.added;
        removed[metric] = delta.removed;
      } else {
        added[metric] = (prevAdded ?? 0) + delta.added;
        removed[metric] = (prevRemoved ?? 0) + delta.removed;
      }
    })
  );

  let prevDate: string | null = null;
  if (previousIdset) {
    if (previousIdset.date !== date) {
      prevDate = previousIdset.date;
    } else {
      prevDate = priorNormalized?.prevDate ?? previousIdset.date;
    }
  }

  const snapshot: AdminStatsSnapshot = {
    _id: snapshotKey(scope, date),
    scope,
    date,
    at: now,
    prevDate,
    counts,
    added,
    removed
  };

  // Small snapshot first so a crash cannot drop the day's numbers.
  await snapshotCollection.updateOne({ _id: snapshot._id }, { $set: snapshot }, { upsert: true });

  await idsetCollection.updateOne(
    { _id: idsetKey(scope) },
    {
      $set: {
        _id: idsetKey(scope),
        date,
        hashes: nextHashes
      }
    },
    { upsert: true }
  );

  return { snapshot, baseline };
};

/** Ascending snapshot history ending at the latest capture. */
export const listAdminStatsSnapshots = async (
  options: { scope?: string; days?: number; client?: MongoClient } = {}
): Promise<AdminStatsSnapshot[]> => {
  const client = options.client ?? mongo;
  const scope = options.scope ?? STATS_SCOPE_SITE;
  const days = Math.max(1, options.days ?? 30);

  const rows = await client
    .db()
    .collection(STATS_SNAPSHOT_COLLECTION)
    .find({ scope })
    .sort({ date: -1 })
    .limit(days)
    .toArray();

  return rows
    .map((row) => normalizeSnapshot(row))
    .filter((row): row is AdminStatsSnapshot => row !== null)
    .reverse();
};

const sumPeriodDelta = (snapshots: AdminStatsSnapshot[], metric: DiffMetric): PeriodDelta => {
  let added = 0;
  let removed = 0;
  let hasData = false;

  for (const snapshot of snapshots) {
    const addValue = snapshot.added[metric];
    const removeValue = snapshot.removed[metric];
    if (addValue == null && removeValue == null) continue;
    hasData = true;
    added += addValue ?? 0;
    removed += removeValue ?? 0;
  }

  if (!hasData) {
    return { added: null, removed: null, net: null };
  }

  return { added, removed, net: added - removed };
};

/**
 * Snapshot view for the admin dashboard: trailing period diffs (default 7d),
 * latest day diffs, and the counts series used for trend charts.
 */
export const getAdminStatsSnapshotView = async (
  options: { scope?: string; days?: number; periodDays?: number; client?: MongoClient } = {}
): Promise<AdminStatsSnapshotView> => {
  const days = Math.max(1, options.days ?? 30);
  const periodDays = Math.max(1, options.periodDays ?? 7);
  const snapshots = await listAdminStatsSnapshots({
    scope: options.scope,
    days: Math.max(days, periodDays),
    client: options.client
  });

  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const trendSeries = snapshots.slice(-days).map((snapshot) => ({
    date: snapshot.date,
    counts: { ...snapshot.counts }
  }));

  const periodWindow = snapshots.slice(-periodDays);
  const delta = Object.fromEntries(
    DIFF_METRICS.map((metric) => [metric, sumPeriodDelta(periodWindow, metric)])
  ) as Record<DiffMetric, PeriodDelta>;

  const dayDelta = Object.fromEntries(
    DIFF_METRICS.map((metric) => {
      if (!latest) {
        return [metric, { added: null, removed: null, net: null } satisfies PeriodDelta];
      }
      const addValue = latest.added[metric];
      const removeValue = latest.removed[metric];
      if (addValue == null && removeValue == null) {
        return [metric, { added: null, removed: null, net: null } satisfies PeriodDelta];
      }
      const add = addValue ?? 0;
      const remove = removeValue ?? 0;
      return [metric, { added: add, removed: remove, net: add - remove } satisfies PeriodDelta];
    })
  ) as Record<DiffMetric, PeriodDelta>;

  return {
    latest,
    series: trendSeries,
    period: { days: periodDays, delta },
    day: {
      capturedAt: latest?.at ?? null,
      prevDate: latest?.prevDate ?? null,
      delta: dayDelta
    }
  };
};

/** Convert a snapshot series into TrendPoint[] for a single metric. */
export const snapshotSeriesToTrend = (
  series: SnapshotSeriesPoint[],
  metric: StatsMetric
): Array<{ date: string; value: number }> =>
  series.map((point) => ({
    date: point.date,
    value: point.counts[metric] ?? 0
  }));

/**
 * Opportunistic capture used by the dashboard when the latest snapshot is
 * stale. Fire-and-forget from request handlers — never blocks the page.
 */
export const maybeCaptureStaleAdminStatsSnapshot = (
  client: MongoClient = mongo,
  maxAgeMs = 26 * 60 * 60 * 1000
): void => {
  void (async () => {
    try {
      const latest = await client
        .db()
        .collection(STATS_SNAPSHOT_COLLECTION)
        .find({ scope: STATS_SCOPE_SITE })
        .sort({ date: -1 })
        .limit(1)
        .toArray();
      const row = latest[0] as { at?: Date | string } | undefined;
      const at = row?.at instanceof Date ? row.at : row?.at ? new Date(row.at) : null;
      if (at && Date.now() - at.getTime() < maxAgeMs) return;
      await captureAdminStatsSnapshot(client);
    } catch (err) {
      console.error('[admin-stats] opportunistic snapshot failed:', err);
    }
  })();
};
