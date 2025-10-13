import { error, fail, isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { University, Club } from '$lib/types';
import { nanoid } from 'nanoid';
import { resolve } from '$app/paths';
import { loginRedirect } from '$lib/utils/scoped';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import meili from '$lib/db/meili.server';
import { toPlainObject } from '$lib/utils';

export const load: PageServerLoad = async ({ url, locals }) => {
  const session = await locals.auth();

  if (!session || !session.user) {
    throw loginRedirect(url);
  }

  const universityId = url.searchParams.get('university');

  if (!universityId) {
    error(400, m.university_id_is_required());
  }

  try {
    const db = mongo.db();
    const universitiesCollection = db.collection<University>('universities');

    const university = await universitiesCollection.findOne({ id: universityId });

    if (!university) {
      error(404, m.university_not_found());
    }

    return {
      university: {
        id: university.id,
        name: university.name,
        avatarUrl: university.avatarUrl
      }
    };
  } catch (err) {
    if (isHttpError(err) || isRedirect(err)) {
      throw err;
    }
    console.error('Error loading university:', err);
    error(500, m.failed_to_load_university_information());
  }
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
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
        return fail(400, { message: m.name_slug_and_university_are_required() });
      }

      // Validate slug format
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return fail(400, {
          message: m.slug_can_only_contain_lowercase_letters_numbers_and_hyphens()
        });
      }

      const db = mongo.db();
      const clubsCollection = db.collection<Club>('clubs');
      const universitiesCollection = db.collection<University>('universities');

      // Verify university exists
      const university = await universitiesCollection.findOne({ id: universityId });
      if (!university) {
        return fail(404, { message: m.university_not_found() });
      }

      // Check if slug is unique
      const existingClub = await clubsCollection.findOne({ slug });
      if (existingClub) {
        return fail(400, { message: m.this_slug_is_already_taken() });
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

      const result = await clubsCollection.insertOne(club);
      await meili
        .index<Club>('clubs')
        .addDocuments([toPlainObject({ _id: result.insertedId, ...club })], { primaryKey: 'id' });

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
      return fail(500, { message: m.failed_to_create_club() });
    }

    redirect(302, resolve('/(main)/clubs/[id]', { id: slug }));
  }
};
