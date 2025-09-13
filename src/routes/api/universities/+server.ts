import { json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { University } from '$lib/types';
import mongo from '$lib/db/index.server';

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q');

  if (!query || query.trim().length === 0) {
    return json({ universities: [] });
  }

  try {
    const db = mongo.db();
    const universitiesCollection = db.collection('universities');

    let universities: University[];

    try {
      // Try Atlas Search first
      universities = (await universitiesCollection
        .aggregate([
          {
            $search: {
              index: 'default',
              compound: {
                should: [
                  {
                    text: {
                      query: query,
                      path: 'name',
                      score: { boost: { value: 2 } }
                    }
                  },
                  {
                    text: {
                      query: query,
                      path: 'campuses.name'
                    }
                  }
                ]
              }
            }
          },
          {
            $limit: 10
          }
        ])
        .toArray()) as unknown as University[];
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code !== 6047401 /* SearchNotEnabled */
      ) {
        // If the error is not related to the index not existing, rethrow it
        throw err;
      }
      universities = (await universitiesCollection
        .find({
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { 'campuses.name': { $regex: query, $options: 'i' } }
          ]
        })
        .limit(10)
        .toArray()) as unknown as University[];
    }

    return json({ universities });
  } catch (err) {
    console.error('Error searching universities:', err);
    error(500, 'Failed to search universities');
  }
};
