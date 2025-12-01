import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Club, University } from '$lib/types';
import { sanitizeHTML, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import meili from '$lib/db/meili.server';

export const load: PageServerLoad = async ({ url, parent }) => {
  const query = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const universityId = url.searchParams.get('university') || '';
  const limit = 20;
  const skip = (page - 1) * limit;

  // Get session data immediately for quick initial render
  const { session } = await parent();

  // Get list of universities for filter dropdown (fast query)
  const universitiesPromise = (async () => {
    try {
      const db = mongo.db();
      const universitiesCollection = db.collection<University>('universities');
      const allUniversities = await universitiesCollection
        .find({})
        .sort({ name: 1 })
        .collation({ locale: 'zh@collation=gb2312han' })
        .project({ _id: 0, id: 1, name: 1 })
        .toArray();
      return allUniversities;
    } catch (err) {
      console.error('Error loading universities list:', err);
      return [];
    }
  })();

  // Stream the clubs data
  const clubsData = (async () => {
    try {
      const db = mongo.db();
      const clubsCollection = db.collection<Club>('clubs');
      const universitiesCollection = db.collection<University>('universities');

      let clubs: (Club & { universityName?: string; universityAvatarUrl?: string | null } & {
        _rankingScore?: number;
        nameHl?: Club['name'];
        descriptionHl?: Club['description'];
      })[] = [];
      let totalCount = 0;

      // Build base filter
      const baseFilter: Record<string, unknown> = {};
      if (universityId) {
        baseFilter.universityId = universityId;
      }

      if (query.trim().length > 0) {
        try {
          let filter: string | undefined;
          if (universityId) {
            filter = `universityId = ${universityId}`;
          }

          const searchResults = await meili.index<Club>('clubs').search(query, {
            filter,
            limit,
            offset: skip,
            attributesToHighlight: ['name', 'description'],
            highlightPreTag: '<span class="text-highlight">',
            highlightPostTag: '</span>',
            showRankingScore: true
          });

          clubs = await Promise.all(
            searchResults.hits.map(
              async (hit) =>
                ({
                  ...hit,
                  ...(hit._formatted
                    ? {
                        nameHl: await sanitizeHTML(hit._formatted.name),
                        descriptionHl: await sanitizeHTML(hit._formatted.description)
                      }
                    : {})
                }) as (typeof clubs)[number]
            )
          );
          totalCount = searchResults.estimatedTotalHits;
        } catch {
          // Fallback to regex search
          const searchQuery: Record<string, unknown> = { ...baseFilter };
          searchQuery.$or = [
            { name: { $regex: query, $options: 'i' } },
            { description: { $regex: query, $options: 'i' } }
          ];

          totalCount = await clubsCollection.countDocuments(searchQuery);
          clubs = (await clubsCollection
            .find(searchQuery)
            .sort({ name: 1 })
            .collation({ locale: 'zh@collation=gb2312han' })
            .skip(skip)
            .limit(limit)
            .toArray()) as (Club & {
            universityName?: string;
            universityAvatarUrl?: string | null;
          })[];
        }
      } else {
        // No search query, just filter by university if needed
        totalCount = await clubsCollection.countDocuments(baseFilter);
        clubs = (await clubsCollection
          .find(baseFilter)
          .sort({ createdAt: 1 })
          .skip(skip)
          .limit(limit)
          .toArray()) as (Club & {
          universityName?: string;
          universityAvatarUrl?: string | null;
        })[];
      }

      // Get university names for clubs
      const universityIds = [...new Set(clubs.map((club) => club.universityId))];
      const universities = await universitiesCollection
        .find({ id: { $in: universityIds } })
        .toArray();

      const universityMap = new Map(
        universities.map((u) => [
          u.id,
          {
            name: u.name,
            avatarUrl: u.avatarUrl
          }
        ])
      );

      // Add university names and avatars to clubs
      clubs = clubs.map((club) => {
        const universityInfo = universityMap.get(club.universityId);
        return {
          ...toPlainObject(club),
          universityName: universityInfo?.name,
          universityAvatarUrl: universityInfo?.avatarUrl
        };
      });

      return {
        clubs,
        totalCount,
        currentPage: page,
        hasNextPage: skip + clubs.length < totalCount,
        hasPrevPage: page > 1
      };
    } catch (err) {
      if (err && (isHttpError(err) || isRedirect(err))) {
        throw err;
      }
      console.error('Error loading clubs:', err);
      throw error(500, m.failed_to_load_clubs());
    }
  })();

  return {
    clubsData,
    universitiesPromise,
    query,
    selectedUniversityId: universityId,
    user: session?.user
  };
};
