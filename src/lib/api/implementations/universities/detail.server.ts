/**
 * The university detail: one university, addressed by id or by slug.
 */
import { implement } from '@orpc/server';
import { universitiesContract } from '../../contracts/universities';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

import { normalizeUniversityDocument } from '$lib/utils/organizations.server';
import { universityDetailResponseSchema } from '$lib/schemas/organizations';
import { type University } from '$lib/types';

const impl = implement(universitiesContract).$context<ApiContext>();

export const universitiesDetailImplementation = {
  detail: impl.detail.handler(async ({ input }) => {
    const { id } = input;

    try {
      const db = mongo.db();
      const universitiesCollection = db.collection('universities');

      // Try to find university by ID first, then by slug
      let university = (await universitiesCollection.findOne({
        id: id
      })) as unknown as University | null;

      if (!university) {
        university = (await universitiesCollection.findOne({
          slug: id
        })) as unknown as University | null;
      }

      if (!university) {
        apiError('NOT_FOUND', m.university_not_found());
      }

      const normalizedUniversity = normalizeUniversityDocument(university);

      return toPlainWire(universityDetailResponseSchema, {
        university: normalizedUniversity
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_university_data());
    }
  })
};
