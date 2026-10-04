/**
 * ── Shop↔Station Assignment ─────────────────────────────────────────────────
 * Shared shop↔station assignment primitives plus the single-shop incremental
 * path. The full openmetro sync's Phase 3 (sync.server.ts) uses the same
 * `buildShopMetro` / `shopTransitUpdate` helpers, so the persisted
 * `transit.metro` shape and the set/unset semantics have exactly one source
 * of truth; the incremental path merely executes the update immediately.
 *
 * Import safety: same rule as snapshot/graph/route — the MongoClient is
 * injected by the caller, never imported here.
 */
import type { MongoClient } from 'mongodb';
import type { ShopMetro } from '$lib/schemas/metro';
import { computeWalkSeconds, snapShopLocation, type MetroSnapResult } from './graph.server';
import { createStationLineBadges } from './rankings.server';
import type { MetroStationDoc } from './schemas';
import { getMetroSnapshot } from './snapshot.server';

/**
 * Build the persisted `transit.metro` from a snap result. `stationLines`
 * resolves a station's line badges (inject `createStationLineBadges(lineMap)`).
 * Returns null when the shop has no station within walking distance.
 */
export const buildShopMetro = (
  snap: MetroSnapResult | null,
  stationLines: (station: MetroStationDoc) => ShopMetro['lines']
): ShopMetro | null =>
  snap
    ? {
        networkId: snap.station.networkId,
        stationId: snap.station._id,
        stationName: snap.station.name,
        names: snap.station.names,
        walkSeconds: computeWalkSeconds(snap.distanceKm),
        distanceKm: Math.round(snap.distanceKm * 1000) / 1000,
        lines: stationLines(snap.station)
      }
    : null;

export type ShopTransitUpdate =
  { $set: { 'transit.metro': ShopMetro } } | { $unset: { 'transit.metro': '' } };

/**
 * Diff the persisted assignment against the recomputed one; null means the
 * shop's `transit.metro` is already up to date and must not be rewritten.
 */
export const shopTransitUpdate = (
  current: ShopMetro | null | undefined,
  next: ShopMetro | null
): ShopTransitUpdate | null =>
  JSON.stringify(current ?? null) === JSON.stringify(next)
    ? null
    : next
      ? { $set: { 'transit.metro': next } }
      : { $unset: { 'transit.metro': '' } };

interface AssignableShop {
  id: number;
  location?: { coordinates?: number[] } | null;
  transit?: { metro?: ShopMetro | null } | null;
}

/**
 * Recompute `transit.metro` for one shop against the in-memory metro
 * snapshot. No-op when the persisted assignment already matches; a shop
 * farther than METRO_ACCESS_MAX_KM from any operating station gets the
 * field unset — identical semantics to the full sync's Phase 3.
 */
export const reassignShopTransit = async (client: MongoClient, shopId: number): Promise<void> => {
  const db = client.db();
  const shop = (await db
    .collection('shops')
    .findOne(
      { id: shopId },
      { projection: { id: 1, location: 1, transit: 1 } }
    )) as AssignableShop | null;
  if (!shop) return;

  const snapshot = await getMetroSnapshot(client);
  const snap = snapShopLocation(snapshot.operatingStations, shop.location);

  const transitUpdate = shopTransitUpdate(
    shop.transit?.metro,
    buildShopMetro(snap, createStationLineBadges(snapshot.linesById))
  );
  if (!transitUpdate) return;

  await db.collection('shops').updateOne({ id: shopId }, transitUpdate);
};

/**
 * Fire-and-forget wrapper for request paths: an assignment failure must
 * never fail the shop write that triggered it (the full openmetro sync
 * remains the system of record and heals any gap).
 */
export const reassignShopTransitInBackground = (client: MongoClient, shopId: number): void => {
  queueMicrotask(() => {
    void reassignShopTransit(client, shopId).catch((error) => {
      console.error(`[Metro Assign] Failed to reassign transit for shop ${shopId}:`, error);
    });
  });
};
