import { MONGODB_URI } from '$env/static/private';
import { error } from '@sveltejs/kit';
import { MongoClient } from 'mongodb';
import type { Shop } from '$lib/types';
import { areValidCoordinates, calculateDistance, toPlainObject } from '$lib/utils';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const loadShops = async ({ url }: { url: URL }) => {
  const latParam = url.searchParams.get('latitude') ?? url.searchParams.get('lat');
  const lngParam = url.searchParams.get('longitude') ?? url.searchParams.get('lng');
  if (!latParam || !lngParam) {
    throw error(400, 'Latitude and longitude parameters are required');
  }

  const validationResult = areValidCoordinates(latParam, lngParam);
  if (!validationResult.isValid) {
    throw error(400, 'Invalid latitude or longitude format');
  }

  try {
    const { latitude, longitude } = validationResult;
    const radiusParam = url.searchParams.get('radius');
    const radiusKm = radiusParam ? Math.max(1, Math.min(30, parseInt(radiusParam))) : 10;
    const radiusRadians = radiusKm / 6371;

    const mongoClient = await clientPromise;
    const db = mongoClient.db();
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
    console.error('Error loading shops:', err);
    throw error(500, 'Failed to load shops from database');
  }
};
