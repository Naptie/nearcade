import { error, redirect } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { MongoClient } from 'mongodb';
import type { PageServerLoad } from './$types.js';
import type { InviteLink, University, Club } from '$lib/types';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const { code } = params;
  const session = await locals.auth();

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
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
      throw error(404, 'Invalid or expired invite link');
    }

    // Check if invite is expired
    if (invite.expiresAt && new Date() > new Date(invite.expiresAt)) {
      throw error(410, 'This invite link has expired');
    }

    // Check if invite has reached max uses
    if (invite.maxUses && invite.currentUses >= invite.maxUses) {
      throw error(410, 'This invite link has been used up');
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
      throw error(404, `${invite.type === 'university' ? 'University' : 'Club'} not found`);
    }

    // If user is not signed in, redirect to sign in
    if (!session?.user) {
      throw redirect(302, `/auth/signin?callbackUrl=${encodeURIComponent(`/invite/${code}`)}`);
    }

    return {
      invite,
      targetInfo,
      user: session.user
    };
  } catch (err) {
    console.error('Error loading invite:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    throw error(500, 'Failed to load invite');
  }
};
