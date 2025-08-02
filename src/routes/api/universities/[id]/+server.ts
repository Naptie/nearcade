import { json } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { error } from '@sveltejs/kit';
import { MongoClient } from 'mongodb';
import type { RequestHandler } from './$types';
import type { University } from '$lib/types';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const GET: RequestHandler = async ({ params }) => {
  const { id } = params;

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
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
    console.error('Error loading university:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load university data');
  }
};
