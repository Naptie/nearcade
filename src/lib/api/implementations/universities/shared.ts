/**
 * Plumbing shared by the university implementations.
 *
 * The university routes address a university by id or by slug, so every
 * module that has to resolve a university resolves it the same way — one
 * document, one lookup.
 */
import mongo from '$lib/db/index.server';
import type { University } from '$lib/types';

/**
 * The university a route addresses, by id or by slug.
 */
export const findUniversityByRouteId = (id: string) =>
  mongo
    .db()
    .collection<University>('universities')
    .findOne({ $or: [{ id }, { slug: id }] });
