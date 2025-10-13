import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { University } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import meili from '$lib/db/meili.server';

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
      try {
        // Search using Meilisearch
        const searchResults = await meili.index<University>('universities').search(query, {
          limit,
          offset: skip
        });

        universities = searchResults.hits;
        totalCount = searchResults.estimatedTotalHits;
      } catch {
        // Fallback to regex search
        const searchQuery = {
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { 'campuses.name': { $regex: query, $options: 'i' } }
          ]
        };

        totalCount = await universitiesCollection.countDocuments(searchQuery);
        universities = (await universitiesCollection
          .find(searchQuery)
          .sort({ studentsCount: -1, clubsCount: -1 })
          .skip(skip)
          .limit(limit)
          .toArray()) as unknown as University[];
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
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading universities:', err);
    error(500, m.failed_to_load_universities());
  }
};
