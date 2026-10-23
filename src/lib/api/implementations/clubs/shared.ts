/**
 * Plumbing shared by the club implementations.
 *
 * The club routes address a club by id or by slug, so every module that has
 * to resolve a club resolves it the same way — one document, one lookup.
 */
import mongo from '$lib/db/index.server';
import type { Club } from '$lib/types';

/**
 * The club a route addresses, by id or by slug.
 */
export const findClubByRouteId = (id: string) =>
  mongo
    .db()
    .collection<Club>('clubs')
    .findOne({ $or: [{ id }, { slug: id }] });
