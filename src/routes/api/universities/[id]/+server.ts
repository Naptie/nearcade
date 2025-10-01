import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { University } from '$lib/types';
import mongo from '$lib/db/index.server';

export const GET: RequestHandler = async ({ params }) => {
  const { id } = params;

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
      error(404, 'University not found');
    }

    return json({ university });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading university:', err);
    error(500, 'Failed to load university data');
  }
};
