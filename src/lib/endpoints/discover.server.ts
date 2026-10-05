import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Game, Shop } from '$lib/types';
import { calculateDistance, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toShopApi } from '$lib/utils/shops/api.server';
import { getShopsAttendanceData } from './attendance.server';
import type { PublicUser } from '$lib/auth/types';
import {
  discoverQuerySchema,
  discoverResponseSchema,
  type DiscoverResponse
} from '$lib/schemas/discover';
import { parseQueryOrError } from '$lib/utils/validation.server';
import { translateToGcj02 } from '$lib/utils/geo.server';
import {
  METRO_ENTRY_OVERHEAD_SECONDS,
  METRO_EXIT_OVERHEAD_SECONDS,
  getTravelBudget
} from '$lib/constants';
import type { ShopMetro } from '$lib/schemas/metro';
import { computeWalkSeconds, snapToStation, runMetroDijkstra } from '$lib/openmetro/graph.server';
import { buildShopMongoFilter } from '$lib/utils/shops/filter-query.server';
import { isShopOpenAt } from '$lib/utils/shops/derived';
import { parseShopFilterParam, withoutGeoFilter } from '$lib/utils/shops/filter';
import type { MetroDijkstra, MetroSnapResult } from '$lib/openmetro/graph.server';
import { getMetroSnapshot } from '$lib/openmetro/snapshot.server';
import type { MetroSnapshotNetwork } from '$lib/openmetro/snapshot.server';
import { assembleMetroBlock, buildShopItinerary } from '$lib/openmetro/route.server';
import type { MetroShopItinerary } from '$lib/openmetro/route.server';
import {
  computeMetroTripSeconds,
  estimateTravel,
  type MetroItinerary,
  type ShopTravelEstimate
} from '$lib/utils/travel';

export const loadShops = async ({ url }: { url: URL }): Promise<DiscoverResponse> => {
  const queryUrl = new URL(url);
  if (!queryUrl.searchParams.has('latitude') && queryUrl.searchParams.has('lat')) {
    queryUrl.searchParams.set('latitude', queryUrl.searchParams.get('lat')!);
  }
  if (!queryUrl.searchParams.has('longitude') && queryUrl.searchParams.has('lng')) {
    queryUrl.searchParams.set('longitude', queryUrl.searchParams.get('lng')!);
  }
  if (!queryUrl.searchParams.has('latitude') || !queryUrl.searchParams.has('longitude')) {
    error(400, m.latitude_and_longitude_parameters_are_required());
  }

  const parsedQuery = parseQueryOrError(discoverQuerySchema, queryUrl);
  let { latitude, longitude } = parsedQuery;
  const {
    radius: radiusKm,
    limit: resultCount,
    gameTitleIds,
    fetchAttendance,
    includeTimeInfo,
    convertFrom
  } = parsedQuery;
  // Structured filter (same `f` contract as /shops); legacy gameTitleIds keep
  // working alongside it. `geo` is dropped: this page already owns the origin
  // and radius (they drive the metro search), so a second radius in the filter
  // would contradict them. Stripped here as well as in the panel so the active
  // filter count and the query can never disagree.
  const parsedFilter = parseShopFilterParam(queryUrl.searchParams.get('f'));
  const structuredFilter = parsedFilter ? withoutGeoFilter(parsedFilter) : null;
  const structuredParts: Record<string, unknown>[] = structuredFilter
    ? Object.keys(buildShopMongoFilter(structuredFilter)).length > 0
      ? [buildShopMongoFilter(structuredFilter) as Record<string, unknown>]
      : []
    : [];

  // Convert coordinates from a non-GCJ-02 system if requested.
  // Tencent coord translate first (per-feature daily quota); AMap remains the
  // fallback so discovery degrades gracefully if Tencent is unavailable.
  if (convertFrom) {
    const converted = await translateToGcj02(longitude, latitude, convertFrom, url.origin);
    if (converted) {
      [longitude, latitude] = converted;
    } else {
      console.error('Coordinate translation failed for all providers; using original coords');
    }
  }

  try {
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');

    const nearSpec: Record<string, unknown> = {
      $geometry: { type: 'Point', coordinates: [longitude, latitude] }
    };
    if (radiusKm > 0) {
      nearSpec.$maxDistance = radiusKm * 1000;
    }

    const legacyParts: Record<string, unknown>[] = [];
    if (gameTitleIds && gameTitleIds.length > 0) {
      legacyParts.push({ 'games.titleId': { $all: gameTitleIds } });
    }
    const query: Record<string, unknown> = {
      location: { $near: nearSpec },
      ...([...structuredParts, ...legacyParts].length > 0
        ? { $and: [...structuredParts, ...legacyParts] }
        : {})
    };

    // The radius doubles as a travel-time budget: the distance option the user
    // picked implies how long that trip normally takes, and every candidate
    // shop must fit it. `null` means unlimited (radius 0) — no time cap.
    const budget = radiusKm > 0 ? getTravelBudget(radiusKm) : null;
    const budgetSeconds = budget === null ? null : budget.minutes * 60;

    // ── Metro arm: snap origin → Dijkstra → indexed $in retrieval ───────────
    // Supplies each candidate shop's itinerary. Whether that itinerary is worth
    // taking is decided per shop below by racing it against the straight-line
    // walk, so a shop stays a plain entry unless the metro genuinely wins.
    interface MetroCandidate {
      shop: Shop;
      metro: ShopMetro;
      /** Full reconstructed itinerary, embedded in the ready-to-serve block. */
      block: MetroShopItinerary;
      /** The facts the eligibility race and the estimate need. */
      trip: MetroItinerary;
    }
    let metroCandidates: MetroCandidate[] = [];
    let dijkstra: MetroDijkstra | null = null;
    let originSnap: MetroSnapResult | null = null;
    let originNetwork: MetroSnapshotNetwork | null = null;
    let snapshot: Awaited<ReturnType<typeof getMetroSnapshot>> | null = null;

    try {
      snapshot = await getMetroSnapshot(mongo);
      if (snapshot.operatingStations.length > 0) {
        originSnap = snapToStation(snapshot.operatingStations, latitude, longitude);
        if (originSnap) {
          const network = snapshot.networks.find(
            (entry) => entry.id === originSnap!.station.networkId
          );
          if (network) {
            originNetwork = network;
            dijkstra = runMetroDijkstra(snapshot, originSnap.station._id);
          }
        }
      }
    } catch (metroError) {
      // Metro enrichment is additive — persisted-data problems must never
      // break the radius arm (§6 degradation).
      console.error('Metro arm skipped (snapshot error):', metroError);
      dijkstra = null;
      originSnap = null;
      originNetwork = null;
      snapshot = null;
    }

    // Stations whose ride alone already blows the budget can never contribute a
    // usable itinerary, so the `$in` set stays a realistic isochrone rather
    // than the whole network. Walks are non-negative, so this is a safe
    // pre-filter; an unlimited radius has no cap.
    const stationCap = budgetSeconds ?? Infinity;
    /** Origin→station access walk, shared by every candidate itinerary. */
    const originWalkSeconds = originSnap ? computeWalkSeconds(originSnap.distanceKm) : 0;
    if (dijkstra && originSnap && snapshot) {
      const reachableStationIds: string[] = [];
      for (const [stationId, { seconds }] of dijkstra.bestStopByStation) {
        if (seconds + METRO_ENTRY_OVERHEAD_SECONDS + METRO_EXIT_OVERHEAD_SECONDS <= stationCap) {
          reachableStationIds.push(stationId);
        }
      }

      if (reachableStationIds.length > 0) {
        const metroQuery: Record<string, unknown> = {
          'transit.metro.stationId': { $in: reachableStationIds },
          ...([...structuredParts, ...legacyParts].length > 0
            ? { $and: [...structuredParts, ...legacyParts] }
            : {})
        };
        const metroShopDocs = (await shopsCollection
          .find(metroQuery, {
            projection: {
              id: 1,
              name: 1,
              comment: 1,
              address: 1,
              openingHours: 1,
              games: 1,
              location: 1,
              timezone: 1,
              isClosed: 1,
              createdAt: 1,
              updatedAt: 1,
              transit: 1
            }
          })
          .toArray()) as unknown as Shop[];

        // Reconstruct each *candidate* station's itinerary once. Only stations
        // an actual shop is assigned to matter, which keeps this to a handful
        // of path walks instead of one per reachable station.
        const itineraryByStation = new Map<string, MetroShopItinerary>();
        const itineraryFor = (stationId: string): MetroShopItinerary | null => {
          const cached = itineraryByStation.get(stationId);
          if (cached) return cached;
          // Legs are independent of the walk times, so placeholder walks are
          // safe here — the per-shop total is computed from the real assignment.
          const itinerary = buildShopItinerary(snapshot!, dijkstra!, originSnap!.distanceKm, {
            networkId: originSnap!.station.networkId,
            stationId,
            stationName: snapshot!.stationsById.get(stationId)?.name ?? '',
            names: snapshot!.stationsById.get(stationId)?.names ?? { zh: '', en: '' },
            walkSeconds: 0,
            distanceKm: 0,
            lines: []
          });
          if (itinerary) itineraryByStation.set(stationId, itinerary);
          return itinerary;
        };

        metroCandidates = metroShopDocs.flatMap((shop) => {
          const metro = shop.transit?.metro;
          if (!metro) return [];
          const inSystemSeconds = dijkstra!.bestStopByStation.get(metro.stationId)?.seconds;
          const block = itineraryFor(metro.stationId);
          if (!block || inSystemSeconds === undefined) return [];
          const totalSeconds = computeMetroTripSeconds(
            originWalkSeconds,
            inSystemSeconds,
            metro.walkSeconds
          );
          return [
            {
              shop,
              metro,
              // Copy the station template: only the egress walk varies by shop.
              block: { ...block, totalSeconds },
              trip: {
                seconds: totalSeconds,
                metroSeconds: inSystemSeconds,
                rideStationIds: block.legs
                  .filter((leg) => leg.kind === 'ride')
                  .flatMap((leg) => leg.stationIds)
              }
            }
          ];
        });
      }
    }

    // ── Candidate pool: radius hits ∪ metro-reachable shops ─────────────────
    // Metro eligibility is judged per shop against the straight-line walk, and
    // that walk depends only on distance — so a shop's verdict is the same at
    // every radius. Widening the search therefore only ever *adds* shops, and
    // the over-fetch exists purely to give the merged pool enough material
    // before the time sort cuts it to `limit`.
    const radiusShops = (await shopsCollection
      .find(query, { limit: Math.min(resultCount * 3, 450) })
      .toArray()) as unknown as Shop[];

    const poolById = new Map<number, Shop>();
    for (const shop of radiusShops) poolById.set(shop.id, shop);
    for (const candidate of metroCandidates) {
      if (!poolById.has(candidate.shop.id)) poolById.set(candidate.shop.id, candidate.shop);
    }
    let shops = [...poolById.values()];
    // Open-now is time-dependent and per-shop-timezone: applied exactly over
    // the assembled pool (no tolerance — tolerances are attendance-only).
    if (structuredFilter?.hours?.openNow) {
      const now = new Date();
      shops = shops.filter((shop) => isShopOpenAt(shop, now));
    }

    const now = new Date();

    // Still the *document* shape at this stage: `timezone`/`isOpen` are read-time
    // facts and are added by `toShopApi` below, alongside the public projection.
    let enrichedShops: (Shop & {
      distance: number;
      travel?: ShopTravelEstimate;
      games: (Game & { totalAttendance?: number })[];
      totalAttendance?: number;
      currentReportedAttendance?: {
        reportedAt: string;
        reportedBy: string;
        reporter: PublicUser;
        comment: string | null;
      } | null;
    })[] = shops.map((shop) => {
      const coordinates = shop.location?.coordinates;

      let distance = Infinity;

      if (coordinates && Array.isArray(coordinates) && coordinates.length === 2) {
        const [shopLng, shopLat] = coordinates;
        distance = calculateDistance(latitude, longitude, shopLat, shopLng);
      }

      // The only estimate we produce is the metro one, and only when the ride
      // beats walking the straight line between at least two stations. Every
      // other shop keeps the pre-metro behaviour: distance, no directions.
      const candidate = metroCandidates.find((entry) => entry.shop.id === shop.id);
      const travel = candidate
        ? estimateTravel({ distanceKm: distance, itinerary: candidate.trip })
        : null;

      return {
        ...shop,
        distance,
        ...(travel ? { travel } : {})
      };
    });

    // Admission: a shop inside the radius is admitted by distance, exactly as
    // before metro existed — it was never filtered by time. Beyond the radius
    // the only justification for an entry is a metro trip that fits the budget
    // the radius implies, which is how the metro surfaces new shops.
    if (budgetSeconds !== null) {
      enrichedShops = enrichedShops.filter(
        (shop) =>
          shop.distance <= radiusKm ||
          (shop.travel !== undefined &&
            Number.isFinite(shop.travel.seconds) &&
            shop.travel.seconds <= budgetSeconds)
      );
    }

    const needsAttendanceFilter = !!structuredFilter?.activity;
    if (fetchAttendance || needsAttendanceFilter) {
      const attendanceData = await getShopsAttendanceData(
        shops.map((shop) => shop.id),
        { fetchRegistered: false, fetchReported: true }
      );

      enrichedShops = enrichedShops.map((shop) => {
        const shopIdentifier = shop.id.toString();
        const data = attendanceData.get(shopIdentifier);

        if (data && data.reported.length > 0) {
          const latestReport = data.reported[0];
          return {
            ...shop,
            games: shop.games.map((game) => ({
              ...game,
              totalAttendance: data.games.find((g) => g.gameId === game.gameId)!.total
            })),
            totalAttendance: data.total || 0,
            currentReportedAttendance: latestReport
              ? {
                  reportedAt: latestReport.reportedAt,
                  reportedBy: latestReport.reportedBy,
                  reporter: latestReport.reporter!,
                  comment: latestReport.comment ?? null
                }
              : null
          };
        } else {
          return {
            ...shop,
            games: shop.games.map((game) => ({
              ...game,
              totalAttendance: data?.games.find((g) => g.gameId === game.gameId)?.total || 0
            })),
            totalAttendance: data?.total || 0,
            currentReportedAttendance: null
          };
        }
      });
    }

    // Activity predicates are Redis-derived: filter the enriched shops once
    // the attendance totals are attached.
    if (structuredFilter?.activity) {
      const activity = structuredFilter.activity;
      enrichedShops = enrichedShops.filter((shop) => {
        const total = shop.totalAttendance ?? 0;
        if (activity.attendance?.min !== undefined && total < activity.attendance.min) return false;
        if (activity.attendance?.max !== undefined && total > activity.attendance.max) return false;
        if (activity.gameAttendance) {
          for (const requirement of activity.gameAttendance) {
            const perGame = (shop.games as (Game & { totalAttendance?: number })[])
              .filter((game) => requirement.titleIds.includes(game.titleId))
              .reduce((sum, game) => sum + (game.totalAttendance ?? 0), 0);
            if (requirement.min !== undefined && perGame < requirement.min) return false;
            if (requirement.max !== undefined && perGame > requirement.max) return false;
          }
        }
        return true;
      });
    }

    // Rank by travel time, then by distance as a tie-break, then cut to `limit`
    // so the count is always respected. Shops with no travel estimate have no
    // real time to sort on, so they fall back to their straight-line walking
    // time — an internal ordering key only (it is never displayed, and it is
    // monotonic in distance, so ordinary shops keep their distance order while
    // metro shops slot in by their actual time).
    enrichedShops.sort((a, b) => {
      const timeA = a.travel?.seconds ?? computeWalkSeconds(a.distance);
      const timeB = b.travel?.seconds ?? computeWalkSeconds(b.distance);
      if (timeA !== timeB) return timeA - timeB;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.id - b.id;
    });
    enrichedShops = enrichedShops.slice(0, resultCount);

    // One projection decides what a client sees: the persisted document also
    // carries `_id` and the derived query caches, which never belong here.
    const shopsWithRegions = await Promise.all(
      enrichedShops.map(async (shop) => ({
        ...(await toShopApi(shop, { includeTimeInfo, now })),
        distance: shop.distance,
        ...(shop.travel !== undefined ? { travel: shop.travel } : {}),
        ...(shop.totalAttendance === undefined ? {} : { totalAttendance: shop.totalAttendance }),
        ...(shop.currentReportedAttendance === undefined
          ? {}
          : { currentReportedAttendance: shop.currentReportedAttendance })
      }))
    );

    // Ready-to-serve metro block: only for returned shops that actually have a
    // worthwhile metro itinerary, so a shop reachable on foot never carries a
    // pointless station detour.
    let metroBlock: DiscoverResponse['metro'] = undefined;
    if (dijkstra && originSnap && originNetwork && snapshot) {
      const itineraryByShopId = new Map(
        metroCandidates.map((candidate) => [String(candidate.shop.id), candidate.block])
      );
      const assignedShops = shopsWithRegions
        .filter((shop) => shop.travel !== undefined)
        .flatMap((shop) => {
          const itinerary = itineraryByShopId.get(String(shop.id));
          return itinerary ? [{ id: shop.id, itinerary }] : [];
        });

      if (assignedShops.length > 0) {
        metroBlock =
          assembleMetroBlock({
            snapshot,
            origin: originSnap,
            originCoordinates: { lon: longitude, lat: latitude },
            network: originNetwork,
            assignedShops
          }) ?? undefined;
      }
    }

    const response = discoverResponseSchema.parse(
      toPlainObject({
        shops: shopsWithRegions,
        location: {
          name: url.searchParams.get('name'),
          latitude,
          longitude
        },
        radius: radiusKm,
        limit: resultCount,
        gameTitleIds: gameTitleIds && gameTitleIds.length > 0 ? gameTitleIds : undefined,
        metro: metroBlock
      })
    );
    return response;
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading shops:', err);
    error(500, m.failed_to_load_shops_from_database());
  }
};
