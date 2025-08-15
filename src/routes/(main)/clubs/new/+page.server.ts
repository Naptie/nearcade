import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { University, Club } from '$lib/types';
import { nanoid } from 'nanoid';
import { base } from '$app/paths';
import { loginRedirect } from '$lib/utils/scoped';
import client from '$lib/db/index.server';

export const load: PageServerLoad = async ({ url, locals }) => {
  const session = await locals.auth();

  if (!session || !session.user) {
    throw loginRedirect(url);
  }

  const universityId = url.searchParams.get('university');

  if (!universityId) {
    return fail(400, { message: 'University ID is required' });
  }

  try {
    const db = client.db();
    const universitiesCollection = db.collection<University>('universities');

    const university = await universitiesCollection.findOne({ id: universityId });

    if (!university) {
      return fail(404, { message: 'University not found' });
    }

    return {
      university: {
        id: university.id,
        name: university.name,
        avatarUrl: university.avatarUrl
      }
    };
  } catch (err) {
    console.error('Error loading university:', err);
    return fail(500, { message: 'Failed to load university information' });
  }
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;
    let slug;

    try {
      const formData = await request.formData();
      slug = (formData.get('slug') as string).trim();
      const name = formData.get('name') as string;
      const description = formData.get('description') as string;
      const website = formData.get('website') as string;
      const avatarUrl = formData.get('avatarUrl') as string;
      const backgroundColor = formData.get('backgroundColor') as string;
      const universityId = formData.get('universityId') as string;
      const acceptJoinRequests = formData.get('acceptJoinRequests') === 'on';
      const postReadability = parseInt(formData.get('postReadability') as string);
      const postWritability = parseInt(formData.get('postWritability') as string);

      if (!name?.trim() || !slug?.trim() || !universityId?.trim()) {
        return fail(400, { message: 'Name, slug, and university are required' });
      }

      // Validate slug format
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return fail(400, {
          message: 'Slug can only contain lowercase letters, numbers and hyphens'
        });
      }

      const db = client.db();
      const clubsCollection = db.collection<Club>('clubs');
      const universitiesCollection = db.collection<University>('universities');

      // Verify university exists
      const university = await universitiesCollection.findOne({ id: universityId });
      if (!university) {
        return fail(404, { message: 'University not found' });
      }

      // Check if slug is unique
      const existingClub = await clubsCollection.findOne({ slug });
      if (existingClub) {
        return fail(400, { message: 'This slug is already taken' });
      }

      // Create club
      const clubId = nanoid();
      const club: Club = {
        id: clubId,
        universityId,
        name: name.trim(),
        slug,
        description: description?.trim() || undefined,
        website: website?.trim() || undefined,
        avatarUrl: avatarUrl?.trim() || undefined,
        backgroundColor: backgroundColor || undefined,
        acceptJoinRequests,
        postReadability,
        postWritability,
        starredArcades: [],
        createdAt: new Date(),
        createdBy: user.id
      };

      await clubsCollection.insertOne(club);

      // Add creator as admin member
      const clubMembersCollection = db.collection('club_members');
      await clubMembersCollection.insertOne({
        id: nanoid(),
        clubId,
        userId: user.id,
        memberType: 'admin',
        joinedAt: new Date(),
        invitedBy: null
      });
    } catch (err) {
      console.error('Error creating club:', err);
      return fail(500, { message: 'Failed to create club' });
    }

    redirect(302, `${base}/clubs/${slug}`);
  }
};
