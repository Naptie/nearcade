import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Game, Shop } from '$lib/types';
import { areValidCoordinates, calculateDistance, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { getShopsAttendanceData } from './attendance.server';
import type { User } from '@auth/sveltekit';

export const loadShops = async ({ url }: { url: URL }) => {
  const latParam = url.searchParams.get('latitude') ?? url.searchParams.get('lat');
  const lngParam = url.searchParams.get('longitude') ?? url.searchParams.get('lng');
  if (!latParam || !lngParam) {
    error(400, m.latitude_and_longitude_parameters_are_required());
  }

  const validationResult = areValidCoordinates(latParam, lngParam);
  if (!validationResult.isValid) {
    error(400, m.invalid_latitude_or_longitude_format());
  }

  const fetchAttendance = url.searchParams.get('fetchAttendance') !== 'false';

  try {
    const { latitude, longitude } = validationResult;
    const radiusParam = url.searchParams.get('radius');
    const radiusKm = radiusParam ? Math.max(1, Math.min(30, parseInt(radiusParam))) : 10;
    const radiusRadians = radiusKm / 6371;

    const db = mongo.db();
    const shopsCollection = db.collection('shops');
    const shops = (await shopsCollection
      .find({
        location: {
          $geoWithin: {
            $centerSphere: [[longitude, latitude], radiusRadians]
          }
        }
      })
      .toArray()) as unknown as Shop[];

    let enrichedShops: (Shop & {
      distance: number;
      games: (Game & { totalAttendance?: number })[];
      totalAttendance?: number;
      currentReportedAttendance?: {
        reportedAt: string;
        reportedBy: User;
        comment: string | null;
      } | null;
    })[] = shops.map((shop) => {
      const coordinates = shop.location?.coordinates;

      if (coordinates && Array.isArray(coordinates) && coordinates.length === 2) {
        const [shopLng, shopLat] = coordinates; // GeoJSON format is [longitude, latitude]
        const distance = calculateDistance(latitude, longitude, shopLat, shopLng);

        return {
          ...toPlainObject(shop),
          distance: distance
        };
      }

      return {
        ...toPlainObject(shop),
        distance: Infinity
      };
    });

    if (fetchAttendance) {
      const attendanceData = await getShopsAttendanceData(
        shops.map((shop) => ({ source: shop.source, id: shop.id })),
        { fetchRegistered: false, fetchReported: true }
      );

      enrichedShops = enrichedShops.map((shop) => {
        const shopIdentifier = `${shop.source}-${shop.id}`;
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
                  reportedBy: latestReport.reporter!,
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
    return {
      shops: enrichedShops,
      location: {
        name: url.searchParams.get('name'),
        latitude,
        longitude
      },
      radius: radiusKm
    };
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading shops:', err);
    error(500, m.failed_to_load_shops_from_database());
  }
};
