import { error, isHttpError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { University } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';

export const load: PageServerLoad = async ({ url, parent }) => {
  const query = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;
  const skip = (page - 1) * limit;

  try {
    const db = mongo.db();
    const universitiesCollection = db.collection<University>('universities');

    let universities: University[];
    let totalCount: number;

    if (query.trim().length === 0) {
      // Load all universities with pagination
      totalCount = await universitiesCollection.countDocuments();
      universities = (await universitiesCollection
        .find({})
        .sort({ studentsCount: -1, clubsCount: -1, name: 1 })
        .collation({ locale: 'zh@collation=gb2312han' })
        .skip(skip)
        .limit(limit)
        .toArray()) as unknown as University[];
    } else {
      // Search universities
      let searchResults: University[];

      try {
        // Try Atlas Search first
        searchResults = (await universitiesCollection
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
            { $sort: { score: { $meta: 'searchScore' }, studentsCount: -1, clubsCount: -1 } },
            { $skip: skip },
            { $limit: limit }
          ])
          .toArray()) as unknown as University[];
      } catch {
        // Fallback to regex search
        const searchQuery = {
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { 'campuses.name': { $regex: query, $options: 'i' } }
          ]
        };

        totalCount = await universitiesCollection.countDocuments(searchQuery);
        searchResults = (await universitiesCollection
          .find(searchQuery)
          .sort({ studentsCount: -1, clubsCount: -1 })
          .skip(skip)
          .limit(limit)
          .toArray()) as unknown as University[];
      }

      universities = searchResults;
      if (!totalCount!) {
        totalCount = universities.length + (universities.length === limit ? 1 : 0);
      }
    }

    const { session } = await parent();

    return {
      universities: toPlainArray(universities),
      totalCount,
      currentPage: page,
      hasNextPage: skip + universities.length < totalCount,
      hasPrevPage: page > 1,
      query,
      user: session?.user
    };
  } catch (err) {
    console.error('Error loading universities:', err);
    if (err && isHttpError(err)) {
      throw err;
    }
    error(500, 'Failed to load universities');
  }
};
