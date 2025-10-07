import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { Shop } from '$lib/types';
import { areValidCoordinates, calculateDistance, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const loadShops = async ({ url }: { url: URL }) => {
  const latParam = url.searchParams.get('latitude') ?? url.searchParams.get('lat');
  const lngParam = url.searchParams.get('longitude') ?? url.searchParams.get('lng');
  if (!latParam || !lngParam) {
    error(400, m.error_latitude_and_longitude_parameters_are_required());
  }

  const validationResult = areValidCoordinates(latParam, lngParam);
  if (!validationResult.isValid) {
    error(400, m.error_invalid_latitude_or_longitude_format());
  }

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

    const shopsWithDistance = shops.map((shop) => {
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

    shopsWithDistance.sort((a, b) => a.distance - b.distance);
    return {
      shops: shopsWithDistance,
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
    error(500, m.error_failed_to_load_shops_from_database());
  }
};
