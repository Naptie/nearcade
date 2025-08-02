import { error } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { MongoClient } from 'mongodb';
import type { PageServerLoad } from './$types';
import type { Club, University } from '$lib/types';
import { toPlainObject } from '$lib/utils';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const load: PageServerLoad = async ({ url, parent }) => {
  const query = url.searchParams.get('q') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const universityId = url.searchParams.get('university') || '';
  const limit = 20;
  const skip = (page - 1) * limit;

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
    const clubsCollection = db.collection<Club>('clubs');
    const universitiesCollection = db.collection<University>('universities');

    let clubs: (Club & { universityName?: string; universityAvatarUrl?: string | null })[] = [];
    let totalCount = 0;

    // Build base filter
    const baseFilter: Record<string, unknown> = {};
    if (universityId) {
      baseFilter.universityId = universityId;
    }

    if (query.trim().length > 0) {
      try {
        // Try Atlas Search first
        const pipeline = [
          {
            $search: {
              index: 'default',
              compound: {
                should: [
                  {
                    text: {
                      query,
                      path: 'name',
                      score: { boost: { value: 2 } }
                    }
                  },
                  {
                    text: {
                      query,
                      path: 'description'
                    }
                  }
                ]
              }
            }
          },
          { $match: baseFilter },
          { $sort: { name: 1 } },
          { $skip: skip },
          { $limit: limit }
        ];

        clubs = (await clubsCollection
          .aggregate(pipeline, {
            collation: { locale: 'zh@collation=gb2312han' }
          })
          .toArray()) as (Club & {
          universityName?: string;
          universityAvatarUrl?: string | null;
        })[];

        // Get total count using $search + $match
        const countPipeline = [
          {
            $search: {
              index: 'default',
              compound: {
                should: [
                  {
                    text: {
                      query,
                      path: 'name',
                      score: { boost: { value: 2 } }
                    }
                  },
                  {
                    text: {
                      query,
                      path: 'description'
                    }
                  }
                ]
              }
            }
          },
          { $match: baseFilter },
          { $count: 'count' }
        ];
        const countResult = await clubsCollection.aggregate(countPipeline).toArray();
        totalCount = countResult[0]?.count ?? 0;
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
        .toArray()) as (Club & { universityName?: string; universityAvatarUrl?: string | null })[];
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

    // Get list of universities for filter dropdown
    const allUniversities = await universitiesCollection
      .find({})
      .sort({ name: 1 })
      .collation({ locale: 'zh@collation=gb2312han' })
      .project({ _id: 0, id: 1, name: 1 })
      .toArray();

    const parentData = await parent();

    return {
      clubs,
      totalCount,
      currentPage: page,
      hasNextPage: skip + clubs.length < totalCount,
      hasPrevPage: page > 1,
      query,
      selectedUniversityId: universityId,
      universities: allUniversities,
      user: parentData.session?.user
    };
  } catch (err) {
    console.error('Error loading clubs:', err);
    throw error(500, 'Failed to load clubs');
  }
};
