import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Game, Shop } from '$lib/types';
import { calculateDistance, toPlainObject, getShopOpeningHours, getShopTimezone } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { base } from '$app/paths';
import { getShopsAttendanceData } from './attendance.server';
import type { PublicUser } from '$lib/auth/types';
import {
  discoverQuerySchema,
  discoverResponseSchema,
  type DiscoverResponse
} from '$lib/schemas/discover';
import { parseQueryOrError } from '$lib/utils/validation.server';
import { env } from '$env/dynamic/private';

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
  const { radius: radiusKm, fetchAttendance, includeTimeInfo, convertFrom } = parsedQuery;

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
      // Fall through with original coordinates
    }
  }

  try {
    const radiusRadians = radiusKm / 6371;

    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shops = (await shopsCollection
      .find({
        location: {
          $geoWithin: {
            $centerSphere: [[longitude, latitude], radiusRadians]
          }
        }
      })
      .toArray()) as unknown as Shop[];

    const now = new Date();

    let enrichedShops: (Shop & {
      distance: number;
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
        const [shopLng, shopLat] = coordinates; // GeoJSON format is [longitude, latitude]
        distance = calculateDistance(latitude, longitude, shopLat, shopLng);
      }

      return {
        ...shop,
        ...extraTimeInfo,
        distance
      };
    });

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

    enrichedShops.sort((a, b) => a.distance - b.distance);

    const response = discoverResponseSchema.parse(
      toPlainObject({
        shops: enrichedShops,
        location: {
          name: url.searchParams.get('name'),
          latitude,
          longitude
        },
        radius: radiusKm
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
