import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { University } from '$lib/types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainObject } from '$lib/utils';
import {
  universitiesSearchQuerySchema,
  universitiesSearchResponseSchema
} from '$lib/schemas/organizations';
import { normalizeUniversityDocument } from '$lib/utils/organizations.server';
import { parseQueryOrError } from '$lib/utils/validation.server';
import {
  getUniversitiesCollection,
  isUniversityV2Enabled,
  toUniversityView,
  universitySearchFields
} from '$lib/db/universities.server';

export const GET: RequestHandler = async ({ url }) => {
  const { q: query } = parseQueryOrError(universitiesSearchQuerySchema, url);

  if (!query || query.trim().length === 0) {
    return json(universitiesSearchResponseSchema.parse({ universities: [] }));
  }

  try {
    const db = mongo.db();
    const universitiesCollection = getUniversitiesCollection(db);

    let universities: University[];

    try {
      if (isUniversityV2Enabled()) throw new Error('Use MongoDB fallback for the V2 collection');
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
    } catch {
      universities = (await universitiesCollection
        .find({
          $or: [
            ...universitySearchFields().map((field) => ({
              [field]: { $regex: query, $options: 'i' }
            }))
          ]
        })
        .limit(10)
        .toArray()) as unknown as University[];
    }

    const normalizedUniversities = universities.map((university) =>
      normalizeUniversityDocument(toUniversityView(university))
    );

    return json(
      universitiesSearchResponseSchema.parse(
        toPlainObject({
          universities: normalizedUniversities
        })
      )
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error searching universities:', err);
    error(500, m.failed_to_search_universities());
  }
};
