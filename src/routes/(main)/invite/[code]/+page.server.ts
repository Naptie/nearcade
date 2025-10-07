import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { InviteLink, University, Club } from '$lib/types';
import { loginRedirect } from '$lib/utils/scoped';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const { code } = params;
  const session = await locals.auth();

  // If user is not signed in, redirect to sign in
  if (!session?.user) {
    throw loginRedirect(url);
  }

  try {
    const db = mongo.db();
    const invitesCollection = db.collection<InviteLink>('invite_links');

    // Find the invite by code
    const invite = await invitesCollection.findOne(
      { code, isActive: true },
      {
        projection: {
          _id: 0
        }
      }
    );

    if (!invite) {
      error(404, m.invalid_invite());
    }

    // Check if invite is expired
    if (invite.expiresAt && new Date() > new Date(invite.expiresAt)) {
      error(410, m.this_invite_link_has_expired());
    }

    // Check if invite has reached max uses
    if (invite.maxUses && invite.currentUses >= invite.maxUses) {
      error(410, m.this_invite_link_has_been_used_up());
    }

    // Get target information
    let targetInfo: University | Club | null = null;

    if (invite.type === 'university') {
      const universitiesCollection = db.collection<University>('universities');
      targetInfo = await universitiesCollection.findOne(
        { id: invite.targetId },
        {
          projection: {
            _id: 0
          }
        }
      );
    } else if (invite.type === 'club') {
      const clubsCollection = db.collection<Club>('clubs');
      targetInfo = await clubsCollection.findOne(
        { id: invite.targetId },
        {
          projection: {
            _id: 0
          }
        }
      );
    }

    if (!targetInfo) {
      error(404, invite.type === 'university' ? m.university_not_found() : m.club_not_found());
    }

    return {
      invite,
      targetInfo,
      user: session.user
    };
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading invite:', err);
    error(500, m.failed_to_load_invite());
  }
};
