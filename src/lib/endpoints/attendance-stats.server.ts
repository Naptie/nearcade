import mongo from '$lib/db/index.server';
import meili from '$lib/db/meili.server';
import { getShopOpeningHours } from '$lib/utils';
import { computeShopDerivedFields, type ShopStats } from '$lib/utils/shops/derived';
import type { Shop } from '$lib/types';
import { getShopsAttendanceData } from './attendance.server';

/**
 * Expiry for the denormalized `stats.currentAttendance` sort cache.
 *
 * Redis is the source of truth and cleans itself up: every `nearcade:attend:*`
 * / `nearcade:attend-report:*` key is `setEx`'d with a TTL bounded by the
 * shop's tolerated closing time. Mongo and Meilisearch have no per-field TTL,
 * so the copy written by the attendance endpoints would go stale the moment
 * the last key expires and nobody attends again. Every non-zero cache
 * therefore carries `stats.currentAttendanceExpiresAt` — the instant past
 * which no key of the current session can survive — and a background
 * reconciler recomputes (and typically zeroes) any cache past its marker.
 */

/** The endpoints' `setEx` TTL floor: a key filed at the very end of a session
 * can outlive closeTolerated by this much. */
const ATTENDANCE_TTL_FLOOR_MS = 60_000;

/** Re-check delay when keys outlive their session (clock skew, manual edits) —
 * keeps the reconciler converging without pinning a far-future marker. */
const RECONCILE_BACKOFF_MS = 5 * 60_000;

/** Tick cadence and per-tick batch of the background reconciler. */
const RECONCILE_INTERVAL_MS = 60_000;
const RECONCILE_BATCH = 100;

/**
 * When the last Redis key of the shop's current session is guaranteed gone.
 * The session's tolerated close is the upper bound for every attend/report
 * key TTL; the linger covers the endpoints' TTL floor. Being asked to write a
 * live total past that bound means something is off — re-check soon instead
 * of arming a far-future marker.
 */
const attendanceStatsExpiry = (shop: Shop, now = new Date()): Date => {
  const { closeTolerated } = getShopOpeningHours(shop);
  if (now.getTime() <= closeTolerated.getTime() + ATTENDANCE_TTL_FLOOR_MS) {
    return new Date(closeTolerated.getTime() + ATTENDANCE_TTL_FLOOR_MS);
  }
  return new Date(now.getTime() + RECONCILE_BACKOFF_MS);
};

/**
 * Persist one shop's attendance total into the Mongo `shops` document and the
 * Meilisearch index. Non-zero totals are armed with an expiry marker; a zero
 * total clears it so the shop leaves the reconciler's query set. The Meili
 * update replaces `stats` wholesale, so the derived fields are recomputed from
 * the same document — exactly like `syncShopDocument` does for edits.
 */
const writeShopAttendanceStats = async (shop: Shop, total: number): Promise<void> => {
  const expiresAt = total > 0 ? attendanceStatsExpiry(shop) : undefined;
  const stats: ShopStats & {
    currentAttendance: number;
    currentAttendanceExpiresAt?: Date;
  } = { ...computeShopDerivedFields(shop).stats, currentAttendance: total };
  if (expiresAt) {
    stats.currentAttendanceExpiresAt = expiresAt;
  }

  await mongo
    .db()
    .collection<Shop>('shops')
    .updateOne(
      { _id: shop._id },
      expiresAt
        ? {
            $set: {
              'stats.currentAttendance': total,
              'stats.currentAttendanceExpiresAt': expiresAt
            }
          }
        : {
            $set: { 'stats.currentAttendance': total },
            $unset: { 'stats.currentAttendanceExpiresAt': '' }
          }
    );
  await meili
    .index<Shop>('shops')
    .updateDocuments([{ _id: shop._id, stats }], { primaryKey: '_id' });
};

/**
 * Refresh the denormalized `stats.currentAttendance` after an attendance
 * mutation. The Redis store stays the source of truth for display; this copy
 * exists only so the shop query engine can sort by attendance without
 * scanning Redis. Never throws: an attendance mutation must not fail because
 * its cache refresh did.
 */
export const refreshShopAttendanceStats = async (shop: Shop): Promise<void> => {
  try {
    const attendance = await getShopsAttendanceData([shop.id], {
      fetchRegistered: true,
      fetchReported: true
    });
    await writeShopAttendanceStats(shop, attendance.get(String(shop.id))?.total ?? 0);
  } catch (err) {
    console.error('Failed to refresh shop attendance stats:', err);
  }
};

/**
 * Recompute every shop whose attendance cache is past its expiry marker. In
 * steady state that is a handful of shops per tick (closings); the count only
 * spikes right after a deploy. One shop failing must not stall the batch.
 * Returns the number of shops reconciled. Safe to run concurrently from
 * multiple app instances — every write is a whole-value idempotent upsert.
 */
export const reconcileExpiredAttendanceStats = async (limit = RECONCILE_BATCH): Promise<number> => {
  const stale = await mongo
    .db()
    .collection<Shop>('shops')
    .find({ 'stats.currentAttendanceExpiresAt': { $lte: new Date() } })
    .sort({ 'stats.currentAttendanceExpiresAt': 1 })
    .limit(limit)
    .toArray();
  if (stale.length === 0) return 0;

  let reconciled = 0;
  for (const shop of stale) {
    try {
      const attendance = await getShopsAttendanceData([shop.id], {
        fetchRegistered: true,
        fetchReported: true
      });
      await writeShopAttendanceStats(shop, attendance.get(String(shop.id))?.total ?? 0);
      reconciled++;
    } catch (err) {
      console.error(`Failed to reconcile attendance stats for shop ${shop.id}:`, err);
    }
  }
  if (reconciled > 0) {
    console.log(`[AttendanceStats] Reconciled ${reconciled} expired cache(s)`);
  }
  return reconciled;
};

/**
 * Cache rows written before the expiry marker existed (`currentAttendance > 0`
 * with no marker) would never enter the reconciler's query. Flag them as due
 * now; the first ticks then normalize them like any other stale cache.
 * Idempotent — matches nothing once every live cache carries a marker.
 */
const backfillAttendanceStatsMarkers = async (): Promise<void> => {
  const result = await mongo
    .db()
    .collection<Shop>('shops')
    .updateMany(
      {
        'stats.currentAttendance': { $gt: 0 },
        'stats.currentAttendanceExpiresAt': { $exists: false }
      },
      { $set: { 'stats.currentAttendanceExpiresAt': new Date() } }
    );
  if (result.modifiedCount > 0) {
    console.log(
      `[AttendanceStats] Flagged ${result.modifiedCount} legacy cache(s) for reconciliation`
    );
  }
};

/**
 * Single entry point for the attendance-stats background loop. Call ONCE from
 * the app's ServerInit (`hooks.server.ts`): a boot-time backfill plus an
 * immediate first pass, then a fixed-interval reconciler. The interval is
 * unref'd so it never keeps the process alive on its own.
 */
export const startAttendanceStatsReconciler = (): void => {
  const boot = async (): Promise<void> => {
    try {
      await backfillAttendanceStatsMarkers();
    } catch (err) {
      console.error('[AttendanceStats] Backfill failed:', err);
    }
    await reconcileExpiredAttendanceStats();
  };
  void boot().catch((err) => console.error('[AttendanceStats] Boot pass failed:', err));

  const timer = setInterval(() => {
    void reconcileExpiredAttendanceStats().catch((err) =>
      console.error('[AttendanceStats] Reconcile loop error:', err)
    );
  }, RECONCILE_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
};
