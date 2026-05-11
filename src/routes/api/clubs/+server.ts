import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Club, University } from '$lib/types';
import { sanitizeHTML, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import meili from '$lib/db/meili.server';
import { clubsListQuerySchema, clubsListResponseSchema } from '$lib/schemas/organizations';
import { normalizeClubDocument } from '$lib/utils/organizations.server';
import { parseQueryOrError } from '$lib/utils/validation.server';

export const GET: RequestHandler = async ({ url }) => {
  const { q: query, page, university: universityId } = parseQueryOrError(clubsListQuerySchema, url);
  const limit = 20;
  const skip = (page - 1) * limit;

  try {
    const db = mongo.db();
    const clubsCollection = db.collection<Club>('clubs');
    const universitiesCollection = db.collection<University>('universities');

    const universities = await universitiesCollection
      .find({})
      .sort({ name: 1 })
      .collation({ locale: 'zh@collation=gb2312han' })
      .project({ _id: 0, id: 1, name: 1 })
      .toArray();

    let clubs: (Club & {
      universityName?: string;
      universityAvatarUrl?: string | null;
      _rankingScore?: number;
      nameHl?: Club['name'];
      descriptionHl?: Club['description'];
    })[] = [];
    let totalCount = 0;

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
        const searchQuery: Record<string, unknown> = { ...baseFilter };
        searchQuery.$or = [
          { name: { $regex: query, $options: 'i' } },
          { description: { $regex: query, $options: 'i' } }
        ];

        totalCount = await clubsCollection.countDocuments(searchQuery);
        clubs = await clubsCollection
          .find(searchQuery)
          .sort({ name: 1 })
          .collation({ locale: 'zh@collation=gb2312han' })
          .skip(skip)
          .limit(limit)
          .toArray();
      }
    } else {
      totalCount = await clubsCollection.countDocuments(baseFilter);
      clubs = await clubsCollection
        .find(baseFilter)
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .toArray();
    }

    const normalizedClubs = clubs.map((club) => normalizeClubDocument(club));

    const universityIds = [...new Set(normalizedClubs.map((club) => club.universityId))];
    const clubUniversities = await universitiesCollection
      .find({ id: { $in: universityIds } })
      .toArray();

    const universityMap = new Map(
      clubUniversities.map((university) => [
        university.id,
        {
          name: university.name,
          avatarUrl: university.avatarUrl
        }
      ])
    );

    const enrichedClubs = normalizedClubs.map((club) => {
      const universityInfo = universityMap.get(club.universityId);
      return {
        ...toPlainObject(club),
        universityName: universityInfo?.name,
        universityAvatarUrl: universityInfo?.avatarUrl
      };
    });

    return json(
      clubsListResponseSchema.parse(
        toPlainObject({
          clubs: enrichedClubs,
          universities,
          totalCount,
          currentPage: page,
          hasNextPage: skip + clubs.length < totalCount,
          hasPrevPage: page > 1,
          query,
          selectedUniversityId: universityId
        })
      )
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading clubs:', err);
    error(500, m.failed_to_load_clubs());
  }
};
