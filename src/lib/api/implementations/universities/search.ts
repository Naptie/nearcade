/**
 * The university search: the universities whose name or campus name matches
 * a keyword.
 *
 * The search is answered by Atlas Search when the index can answer it, and by
 * a regular expression over MongoDB when it cannot.
 */
import { implement } from '@orpc/server';
import { universitiesContract } from '../../contracts/universities';
import type { ApiContext } from '../../context';
import { rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

import { normalizeUniversityDocument } from '$lib/utils/organizations.server';
import { universitiesSearchResponseSchema } from '$lib/schemas/organizations';
import { type University } from '$lib/types';

const impl = implement(universitiesContract).$context<ApiContext>();

export const universitiesSearchImplementation = {
  search: impl.search.handler(async ({ input }) => {
    const query = input.q;

    if (!query || query.trim().length === 0) {
      return { universities: [] };
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
      } catch {
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

      const normalizedUniversities = universities.map((university) =>
        normalizeUniversityDocument(university)
      );

      return toPlainWire(universitiesSearchResponseSchema, {
        universities: normalizedUniversities
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_search_universities());
    }
  })
};
