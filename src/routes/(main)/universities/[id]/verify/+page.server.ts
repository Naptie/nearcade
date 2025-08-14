import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { University } from '$lib/types';
import { checkUniversityPermission, loginRedirect } from '$lib/utils';
import { base } from '$app/paths';
import client from '$lib/db.server';
import { AUTH_SECRET, REDIS_URI } from '$env/static/private';
import { createHmac } from 'crypto';
import { createClient } from 'redis';

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
    const { verificationEmail, verifiedAt, ...userPermissions } = await checkUniversityPermission(
      user,
      university,
      client
    );

    if (!userPermissions.canJoin) {
      redirect(302, `${base}/universities/${university.slug || university.id}`);
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const hmac = createHmac('sha256', AUTH_SECRET)
      .update(`${user.id}|${university.id}|${today.toISOString()}`)
      .digest('hex');

    const expires = new Date(today);
    expires.setUTCDate(today.getUTCDate() + 1);

    const redis = createClient({ url: REDIS_URI });
    await redis.connect();
    const status = (await redis.get(`nearcade:ssv:${university.id}:${user.id}`)) as
      | 'success'
      | 'processing'
      | 'untrusted_sender'
      | 'hmac_mismatch'
      | 'underconfigured_university'
      | 'domain_mismatch'
      | 'already_verified'
      | null;

    return {
      university,
      user,
      userPermissions,
      hmac,
      expires,
      status,
      verificationEmail,
      verifiedAt
    };
  } catch (err) {
    console.error('Error loading university:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load university data');
  }
};
