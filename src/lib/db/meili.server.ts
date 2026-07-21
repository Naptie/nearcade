import { Meilisearch } from 'meilisearch';
import mongo from './index.server';
import { toPlainArray } from '$lib/utils';
import { env } from '$env/dynamic/private';
import type { Shop } from '$lib/types';
import { getShopRegionNames } from '$lib/utils/region.server';

let meili: Meilisearch | undefined;

const getMeiliClient = () => {
  if (!meili) {
    const host = env.MEILISEARCH_HOST;

    if (!host) {
      throw new Error('Invalid/Missing environment variable: "MEILISEARCH_HOST"');
    }

    meili = new Meilisearch({
      host,
      apiKey: env.MEILISEARCH_API_KEY
    });
  }

  return meili;
};

const meiliProxy = new Proxy({} as Meilisearch, {
  get(_target, property) {
    const client = getMeiliClient();
    const value = Reflect.get(client, property, client);

    return typeof value === 'function' ? value.bind(client) : value;
  }
});

export const init = async (): Promise<{
  shops: number;
  universities: number;
  clubs: number;
  total: number;
}> => {
  const db = mongo.db();
  const meili = getMeiliClient();
  const shops = await db.collection<Shop>('shops').find().toArray();
  const universities = await db.collection('universities').find().toArray();
  const clubs = await db.collection('clubs').find().toArray();

  // Enrich shops with regionNames (all language variants) for multilingual search
  const shopsWithRegionNames = await Promise.all(
    shops.map(async (shop) => {
      const region = shop.address?.region;
      const regionIds =
        Array.isArray(region) && region.length > 0 && typeof region[0] === 'string'
          ? (region as string[])
          : undefined;
      const regionNames = await getShopRegionNames(regionIds);
      return { ...shop, regionNames };
    })
  );

  // Delete existing indexes if they exist
  await meili.deleteIndexIfExists('shops');
  await meili.deleteIndexIfExists('universities');
  await meili.deleteIndexIfExists('clubs');

  // Get or create the index
  const shopIndex = meili.index('shops');
  const universityIndex = meili.index('universities');
  const clubIndex = meili.index('clubs');

  // Configure searchable/filterable attributes
  await shopIndex.updateSettings({
    searchableAttributes: [
      'name',
      'regionNames',
      'address.general',
      'address.detailed',
      'games.name',
      'games.version',
      'comment'
    ],
    filterableAttributes: ['games.titleId', 'address.region']
  });
  await universityIndex.updateSettings({
    searchableAttributes: [
      'name',
      'description',
      'slug',
      'website',
      'campuses.province',
      'campuses.city',
      'campuses.district',
      'campuses.address'
    ]
  });
  await clubIndex.updateSettings({
    searchableAttributes: ['name', 'description', 'slug', 'website'],
    filterableAttributes: ['universityId']
  });

  // Add documents
  await shopIndex.addDocuments(toPlainArray(shopsWithRegionNames), { primaryKey: '_id' });
  await universityIndex.addDocuments(toPlainArray(universities), { primaryKey: 'id' });
  await clubIndex.addDocuments(toPlainArray(clubs), { primaryKey: 'id' });

  return {
    shops: shopsWithRegionNames.length,
    universities: universities.length,
    clubs: clubs.length,
    total: shopsWithRegionNames.length + universities.length + clubs.length
  };
};

export default meiliProxy;
