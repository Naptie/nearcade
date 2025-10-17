import { Meilisearch } from 'meilisearch';
import mongo from './index.server';
import { toPlainArray } from '$lib/utils';
import { MEILISEARCH_API_KEY, MEILISEARCH_HOST } from '$env/static/private';

const meili = new Meilisearch({
  host: MEILISEARCH_HOST,
  apiKey: MEILISEARCH_API_KEY
});

export const init = async () => {
  const db = mongo.db();
  const shops = await db.collection('shops').find().toArray();
  const universities = await db.collection('universities').find().toArray();
  const clubs = await db.collection('clubs').find().toArray();

  // Delete existing indexes if they exist
  await meili.deleteIndexIfExists('shops');
  await meili.deleteIndexIfExists('universities');
  await meili.deleteIndexIfExists('clubs');

  // Get or create the index
  const shopIndex = meili.index('shops');
  const universityIndex = meili.index('universities');
  const clubIndex = meili.index('clubs');

  // Configure filterable attributes for titleIds filtering
  await shopIndex.updateSettings({
    searchableAttributes: [
      'name',
      'address.general',
      'address.detailed',
      'games.name',
      'games.version',
      'comment'
    ],
    filterableAttributes: ['games.titleId']
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
  await shopIndex.addDocuments(toPlainArray(shops), { primaryKey: '_id' });
  await universityIndex.addDocuments(toPlainArray(universities), { primaryKey: 'id' });
  await clubIndex.addDocuments(toPlainArray(clubs), { primaryKey: 'id' });
};

export default meili;
