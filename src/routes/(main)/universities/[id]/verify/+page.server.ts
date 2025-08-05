import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { University } from '$lib/types';
import { checkUniversityPermission, loginRedirect } from '$lib/utils';
import { base } from '$app/paths';
import client from '$lib/db.server';
import { AUTH_SECRET } from '$env/static/private';
import { createHmac } from 'crypto';

export const load: PageServerLoad = async ({ params, url, parent }) => {
  const { id } = params;

  const { session } = await parent();
  const user = session?.user;

  if (!user) {
    throw loginRedirect(url);
  }

  try {
    const db = client.db();
    const universitiesCollection = db.collection('universities');

    // Try to find university by ID first, then by slug
    let university = (await universitiesCollection.findOne(
      {
        id: id
      },
      { projection: { _id: 0 } }
    )) as unknown as University | null;

    if (!university) {
      university = (await universitiesCollection.findOne(
        {
          slug: id
        },
        { projection: { _id: 0 } }
      )) as unknown as University | null;
    }

    if (!university) {
      error(404, 'University not found');
    }

    // Check permissions for the current user
    const userPermissions = await checkUniversityPermission(user, university, client);

    if (!userPermissions.canJoin) {
      redirect(302, `${base}/universities/${university.slug || university.id}`);
    }

    const hmac = createHmac('sha256', AUTH_SECRET)
      .update(`${user.id}|${university.id}`)
      .digest('hex');

    return {
      university,
      user,
      userPermissions,
      hmac
    };
  } catch (err) {
    console.error('Error loading university:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load university data');
  }
};
