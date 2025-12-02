import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { University } from '$lib/types';
import { PAGINATION } from '$lib/constants';
import { sanitizeHTML, sanitizeRecursive, toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import meili from '$lib/db/meili.server';

export const load: PageServerLoad = async ({ url, parent }) => {
  const query = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;
  const skip = (page - 1) * limit;

  // Get session data immediately for quick initial render
  const { session } = await parent();

  // Stream the universities data
  const universitiesData = (async () => {
    try {
      const db = mongo.db();
      const universitiesCollection = db.collection<University>('universities');

      let universities: (University & {
        _rankingScore?: number;
        nameHl?: University['name'];
        descriptionHl?: University['description'];
        campusesHl?: University['campuses'];
      })[];
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
            offset: skip,
            attributesToHighlight: [
              'name',
              'description',
              'campuses.province',
              'campuses.city',
              'campuses.district'
            ],
            highlightPreTag: '<span class="text-highlight">',
            highlightPostTag: '</span>',
            showRankingScore: true
          });

          universities = await Promise.all(
            searchResults.hits.map(
              async (hit) =>
                ({
                  ...hit,
                  ...(hit._formatted
                    ? {
                        nameHl: await sanitizeHTML(hit._formatted.name),
                        descriptionHl: await sanitizeHTML(hit._formatted.description),
                        campusesHl: await sanitizeRecursive(hit._formatted.campuses)
                      }
                    : {})
                }) as (typeof universities)[number]
            )
          );
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

      return {
        universities: toPlainArray(universities),
        totalCount,
        currentPage: page,
        hasNextPage: skip + universities.length < totalCount,
        hasPrevPage: page > 1
      };
    } catch (err) {
      if (err && (isHttpError(err) || isRedirect(err))) {
        throw err;
      }
      console.error('Error loading universities:', err);
      throw error(500, m.failed_to_load_universities());
    }
  })();

  return {
    universitiesData,
    query,
    user: session?.user
  };
};
