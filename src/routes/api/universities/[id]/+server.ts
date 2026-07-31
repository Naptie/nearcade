import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { toPlainObject } from '$lib/utils';
import {
  universityDetailResponseSchema,
  universityIdParamSchema
} from '$lib/schemas/organizations';
import { normalizeUniversityDocument } from '$lib/utils/organizations.server';
import { parseParamsOrError } from '$lib/utils/validation.server';
import { findUniversityByIdOrSlug } from '$lib/db/universities.server';

export const GET: RequestHandler = async ({ params }) => {
  const { id } = parseParamsOrError(universityIdParamSchema, params);

  try {
    const db = mongo.db();
    const university = await findUniversityByIdOrSlug(db, id);

    if (!university) {
      error(404, m.university_not_found());
    }

    const normalizedUniversity = normalizeUniversityDocument(university);

    return json(
      universityDetailResponseSchema.parse(
        toPlainObject({
          university: normalizedUniversity
        })
      )
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading university:', err);
    error(500, m.failed_to_load_university_data());
  }
};
