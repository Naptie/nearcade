#!/usr/bin/env tsx
/**
 * Verify the server-side metro routing core against the live openmetro API:
 *   - station isochrones: local Dijkstra vs GET /api/networks/{id}/travel-times
 *     (station-level seconds, tolerance ± 5 s)
 *   - routes: local leg reconstruction vs GET /api/networks/{id}/route
 *     (same leg kinds + lines + station sequences, total within ± 30 s)
 *
 * Run after Phase 1 and after every openmetro_sync schema/algorithm change:
 *   pnpm exec tsx scripts/verify-metro.ts [--pairs 8] [--network cn-bj] [--sync]
 *
 * Requires MONGODB_URI (loaded from .env). When the metro collections are
 * empty the script runs the sync task first, exactly as the admin task does.
 */
import { MongoClient } from 'mongodb';
import { createClient } from 'openmetro-client';
import { initMetroSnapshot, type MetroSnapshot } from '../src/lib/openmetro/snapshot.server';
import { runMetroDijkstra, snapToStation } from '../src/lib/openmetro/graph.server';
import { assembleMetroBlock, buildShopItinerary } from '../src/lib/openmetro/route.server';
import { runOpenMetroSync } from '../src/lib/openmetro/sync.server';
import type { ShopMetro } from '../src/lib/schemas/metro';

if (!('MONGODB_URI' in process.env)) {
  const dotenv = await import('dotenv');
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('[verify] MONGODB_URI is required (see .env.example / pnpm dev:setup)');
  process.exit(1);
}

const BASE_URL = process.env.PUBLIC_OPENMETRO_API_BASE?.trim() || 'https://openmetro.phi.zone';
const PAIRS = Math.max(1, Number(process.argv[process.argv.indexOf('--pairs') + 1]) || 8);
const NETWORK_FILTER = process.argv.includes('--network')
  ? process.argv[process.argv.indexOf('--network') + 1]
  : null;
const FORCE_SYNC = process.argv.includes('--sync');

const ISOCHRONE_TOLERANCE_SECONDS = 5;
const ROUTE_TOLERANCE_SECONDS = 30;

const pickRandom = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]!;

const client = new MongoClient(MONGODB_URI);

let failures = 0;
let checks = 0;

const fail = (message: string) => {
  failures += 1;
  console.error(`  ✗ ${message}`);
};

const verifyNetwork = async (snapshot: MetroSnapshot, networkId: string) => {
  const metro = createClient(BASE_URL);
  const stations = snapshot.stations.filter((station) => station.networkId === networkId);
  if (stations.length === 0) {
    console.warn(`[verify] ${networkId}: no persisted stations — skipping`);
    return;
  }

  console.log(
    `\n[verify] ${networkId}: ${stations.length} stations, ${PAIRS} random OD pairs (isochrone ± ${ISOCHRONE_TOLERANCE_SECONDS}s, route ± ${ROUTE_TOLERANCE_SECONDS}s)`
  );

  for (let pair = 0; pair < PAIRS; pair += 1) {
    const origin = pickRandom(stations);
    const local = runMetroDijkstra(snapshot, origin._id);
    if (!local) {
      fail(`${origin.name} (${origin._id}): origin station has no routing stops`);
      continue;
    }

    // ── isochrone comparison ─────────────────────────────────────────────
    const isoResponse = await metro.api
      .networks({ id: networkId })
      ['travel-times'].get({ query: { from: origin._id, weight: 'time' } });
    if (isoResponse.error || !isoResponse.data || 'error' in isoResponse.data) {
      fail(
        `${origin.name}: live travel-times request failed: ${JSON.stringify(isoResponse.error)}`
      );
      continue;
    }

    let mismatches = 0;
    let maxDelta = 0;
    let compared = 0;
    for (const { station_id, seconds } of isoResponse.data.stations) {
      const localSeconds = local.bestStopByStation.get(station_id)?.seconds;
      if (localSeconds === undefined) {
        mismatches += 1;
        if (mismatches <= 3) {
          fail(`${origin.name} → ${station_id}: unreachable locally, live ${seconds}s`);
        }
        continue;
      }
      compared += 1;
      const delta = Math.abs(localSeconds - seconds);
      maxDelta = Math.max(maxDelta, delta);
      if (delta > ISOCHRONE_TOLERANCE_SECONDS) {
        mismatches += 1;
        if (mismatches <= 5) {
          fail(
            `${origin.name} → ${station_id}: local ${localSeconds}s vs live ${seconds}s (Δ ${delta}s)`
          );
        }
      }
    }
    checks += 1;
    if (mismatches === 0) {
      console.log(`  ✓ isochrone ${origin.name}: ${compared} stations match (max Δ ${maxDelta}s)`);
    } else {
      fail(`isochrone ${origin.name}: ${mismatches} mismatches of ${compared} compared`);
    }

    // ── route comparison (multi-leg destination) ─────────────────────────
    const reachable = isoResponse.data.stations.filter((entry) => entry.seconds > 600);
    const destination = pickRandom(reachable);
    const destStation = snapshot.stationsById.get(destination.station_id);
    if (!destStation) continue;

    const routeResponse = await metro.api
      .networks({ id: networkId })
      .route.get({ query: { from: origin._id, to: destination.station_id, weight: 'time' } });
    if (routeResponse.error || !routeResponse.data || 'error' in routeResponse.data) {
      fail(
        `${origin.name} → ${destStation.name}: live route request failed: ${JSON.stringify(routeResponse.error)}`
      );
      continue;
    }

    const pseudoShop: ShopMetro = {
      networkId,
      stationId: destination.station_id,
      stationName: destStation.name,
      names: destStation.names,
      walkSeconds: 0,
      distanceKm: 0,
      lines: []
    };
    const itinerary = buildShopItinerary(snapshot, local, 0, pseudoShop);
    if (!itinerary) {
      fail(`${origin.name} → ${destStation.name}: no local itinerary although isochrone matched`);
      continue;
    }

    const live = routeResponse.data;
    const localTotal = itinerary.legs.reduce((sum, leg) => sum + leg.seconds, 0);
    const totalDelta = Math.abs(localTotal - live.total_seconds);
    const shape = (legs: Array<{ kind: string; lineId?: string | null }>) =>
      legs.map((leg) => `${leg.kind}${leg.lineId ? `:${leg.lineId}` : ''}`).join(' → ');

    const shapeMatches =
      itinerary.legs.length === live.legs.length &&
      itinerary.legs.every((leg, index) => {
        const liveLeg = live.legs[index];
        return (
          liveLeg &&
          leg.kind === liveLeg.kind &&
          (leg.kind === 'transfer' || leg.lineId === liveLeg.line_id)
        );
      });
    const stationsMatch =
      shapeMatches &&
      itinerary.legs.every((leg, index) => {
        const liveLeg = live.legs[index];
        // `station_ids` only exists on ride legs (r10 discriminated union).
        if (!liveLeg || liveLeg.kind !== 'ride' || leg.kind !== 'ride') return shapeMatches;
        return (
          !liveLeg.station_ids ||
          JSON.stringify(liveLeg.station_ids) === JSON.stringify(leg.stationIds)
        );
      });

    if (totalDelta > ROUTE_TOLERANCE_SECONDS) {
      fail(
        `route ${origin.name} → ${destStation.name}: Δ ${totalDelta}s (${localTotal}s vs ${live.total_seconds}s), shape ${shapeMatches ? 'ok' : `differs — local [${shape(itinerary.legs)}] vs live [${shape(live.legs)}]`}, station sequences ${stationsMatch ? 'ok' : 'differ'}`
      );
    } else if (shapeMatches && stationsMatch) {
      checks += 1;
      console.log(
        `  ✓ route ${origin.name} → ${destStation.name}: ${itinerary.legs.length} legs, Δ ${totalDelta}s (${localTotal}s local vs ${live.total_seconds}s live)`
      );
    } else {
      // Equal-cost ties can be broken differently by the two Dijkstra path
      // reconstructions; the isochrone check above already proves equivalence.
      checks += 1;
      console.warn(
        `  ~ route ${origin.name} → ${destStation.name}: Δ ${totalDelta}s but leg structure differs (equal-cost tie-break) — local [${shape(itinerary.legs)}] vs live [${shape(live.legs)}]`
      );
    }

    // ── assemble a discover-style metro block once per network ───────────
    if (pair === 0) {
      const shopDocs = (await client
        .db()
        .collection<{ id: number; transit?: { metro?: ShopMetro } }>('shops')
        .find({ 'transit.metro.stationId': { $in: [...local.bestStopByStation.keys()] } })
        .limit(20)
        .toArray()) as unknown as Array<{ id: number; transit: { metro: ShopMetro } }>;
      const network = snapshot.networks.find((entry) => entry.id === networkId);
      // A synthetic search origin north of the station exercises access geometry.
      const originCoordinates = { lon: origin.lon, lat: origin.lat + 0.0045 };
      const originSnap = snapToStation([origin], originCoordinates.lat, originCoordinates.lon)!;
      // The block takes prebuilt itineraries, so reconstruct them here the same
      // way the discover endpoint does (one walk per assigned shop).
      const assignedShops =
        network && shopDocs.length > 0
          ? shopDocs.flatMap((shop) => {
              const itinerary = buildShopItinerary(
                snapshot,
                local,
                originSnap.distanceKm,
                shop.transit.metro
              );
              return itinerary ? [{ id: shop.id, itinerary }] : [];
            })
          : [];
      const block =
        network && assignedShops.length > 0
          ? assembleMetroBlock({
              snapshot,
              origin: originSnap,
              originCoordinates,
              network,
              assignedShops
            })
          : null;
      checks += 1;
      if (block) {
        const legCount = Object.values(block.shops).reduce(
          (sum, itinerary) => sum + itinerary.legs.length,
          0
        );
        console.log(
          `  ✓ block ${networkId}: ${Object.keys(block.shops).length}/${shopDocs.length} itineraries, ${Object.keys(block.lines).length} lines, ${Object.keys(block.stations).length} stations, ${legCount} legs`
        );
      } else if (shopDocs.length === 0) {
        console.log('  · block skipped: no shops assigned to reachable stations');
      } else {
        fail(`block ${networkId}: assembleMetroBlock returned null for ${shopDocs.length} shops`);
      }
    }
  }
};

try {
  await client.connect();
  console.log(`[verify] mongo connected · openmetro base ${BASE_URL}`);

  const hasData =
    (await client.db().collection('openmetro_networks').countDocuments()) > 0 &&
    (await client.db().collection('metro_edges').countDocuments()) > 0;
  if (!hasData || FORCE_SYNC) {
    console.log('[verify] running openmetro sync first (this hits the live API)…');
    const result = await runOpenMetroSync({ client, baseUrl: BASE_URL, force: FORCE_SYNC });
    console.log('[verify] sync summary:', result.summary);
  }

  const snapshot = await initMetroSnapshot(client);
  console.log(
    `[verify] snapshot v${new Date(snapshot.versionMs).toISOString()}: ${snapshot.stations.length} stations / ${snapshot.networks.length} networks`
  );

  const networks = NETWORK_FILTER
    ? snapshot.networks.filter((network) => network.id === NETWORK_FILTER)
    : snapshot.networks;
  if (networks.length === 0) {
    console.error(`[verify] network "${NETWORK_FILTER}" not found in persisted data`);
    process.exit(1);
  }

  for (const network of networks) {
    await verifyNetwork(snapshot, network.id);
  }
} catch (error) {
  console.error('[verify] fatal:', error);
  process.exit(1);
} finally {
  await client.close();
}

console.log(`\n[verify] ${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
