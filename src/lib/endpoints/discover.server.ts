import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Game, Shop } from '$lib/types';
import { calculateDistance, toPlainObject, getShopOpeningHours, getShopTimezone } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { base } from '$app/paths';
import { expandShopsRegions } from '$lib/utils/region.server';
import { getShopsAttendanceData } from './attendance.server';
import type { PublicUser } from '$lib/auth/types';
import {
  discoverQuerySchema,
  discoverResponseSchema,
  type DiscoverResponse
} from '$lib/schemas/discover';
import { parseQueryOrError } from '$lib/utils/validation.server';
import { env } from '$env/dynamic/private';
import {
  METRO_ENTRY_OVERHEAD_SECONDS,
  METRO_EXIT_OVERHEAD_SECONDS,
  getTravelBudget
} from '$lib/constants';
import type { ShopMetro } from '$lib/schemas/metro';
import { computeWalkSeconds, snapToStation, runMetroDijkstra } from '$lib/openmetro/graph.server';
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

  // Convert coordinates from a non-GCJ-02 system if requested
  if (convertFrom) {
    try {
      const convertUrl = new URL(
        `${base}/_AMapService/v3/assistant/coordinate/convert`,
        url.origin
      );
      convertUrl.searchParams.set('locations', `${longitude},${latitude}`);
      convertUrl.searchParams.set('coordsys', convertFrom);
      convertUrl.searchParams.set('key', env.AMAP_KEY);
      const response = await fetch(convertUrl.toString());
      const data = (await response.json()) as { status: string; info: string; locations?: string };
      if (data.status === '1' && data.locations) {
        const [convertedLng, convertedLat] = data.locations.split(';')[0].split(',').map(Number);
        if (!isNaN(convertedLng) && !isNaN(convertedLat)) {
          longitude = convertedLng;
          latitude = convertedLat;
        }
      } else {
        console.error('AMap coordinate conversion failed:', data.info);
      }
    } catch (err) {
      console.error('Failed to convert coordinates via AMap:', err);
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

    const query: Record<string, unknown> = { location: { $near: nearSpec } };
    if (gameTitleIds && gameTitleIds.length > 0) {
      query['games.titleId'] = { $all: gameTitleIds };
    }

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
          'transit.metro.stationId': { $in: reachableStationIds }
        };
        if (gameTitleIds && gameTitleIds.length > 0) {
          metroQuery['games.titleId'] = { $all: gameTitleIds };
        }
        const metroShopDocs = (await shopsCollection
          .find(metroQuery, {
            projection: {
              _id: 1,
              id: 1,
              name: 1,
              comment: 1,
              address: 1,
              openingHours: 1,
              games: 1,
              location: 1,
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
    const shops = [...poolById.values()];

    const now = new Date();

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
      timezone?: { name: string; offset: number };
      isOpen?: boolean;
    })[] = shops.map((shop) => {
      const coordinates = shop.location?.coordinates;

      const extraTimeInfo = (() => {
        if (!includeTimeInfo)
          return {} as Partial<{
            timezone: { name: string; offset: number };
            isOpen: boolean;
          }>;
        const openingHours = getShopOpeningHours(shop);
        const isOpen = now >= openingHours.openTolerated && now <= openingHours.closeTolerated;
        const timezoneName = getShopTimezone(shop.location);
        return {
          timezone: { name: timezoneName, offset: openingHours.offsetHours },
          isOpen
        };
      })();

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
        ...extraTimeInfo,
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

    if (fetchAttendance) {
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

    const shopsWithRegions = await expandShopsRegions(enrichedShops);

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
