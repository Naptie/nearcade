/**
 * Rules shared by more than one API implementation.
 *
 * They live here so the same rule is not written twice: a rule that exists in
 * two places is a rule that eventually gets applied in one of them only.
 */

import { z } from 'zod';
import { withExistingImages } from '$lib/images/validation.server';
import { formatZodError } from '$lib/utils/validation';
import { apiError } from './errors';

/**
 * The image ids a request refers to must exist.
 *
 * The legacy handler validated the request body with `withExistingImages(...)`,
 * which answered 400 when an image id did not exist. The contract cannot carry
 * that refinement — it reaches for the database, and the contract router is
 * also loaded by the OpenAPI generator, which runs outside SvelteKit — so the
 * check stays here, in the same place in the flow.
 */
const imageIdsSchema = withExistingImages(z.object({ images: z.array(z.string()).optional() }));

/** Answer 400 when one of the referenced image ids does not exist. */
export const assertImagesExist = async (images: string[] | undefined) => {
  const result = await imageIdsSchema.safeParseAsync({ images });
  if (!result.success) {
    apiError('BAD_REQUEST', formatZodError(result.error));
  }
};
