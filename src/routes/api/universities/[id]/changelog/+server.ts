import { json } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { error } from '@sveltejs/kit';
import { MongoClient } from 'mongodb';
import type { RequestHandler } from './$types';
import { getChangelogEntries } from '$lib/changelog.server';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const GET: RequestHandler = async ({ params, url }) => {
  const { id } = params;
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10);

  if (page < 1 || limit < 1 || limit > 100) {
    throw error(400, 'Invalid pagination parameters');
  }

  try {
    const mongoClient = await clientPromise;
    const { entries, total } = await getChangelogEntries(mongoClient, id, {
      limit,
      offset: (page - 1) * limit
    });

    return json({
      entries,
      total,
      page,
      limit,
      hasMore: page * limit < total,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error('Error fetching changelog entries:', err);
    throw error(500, 'Failed to fetch changelog entries');
  }
};
