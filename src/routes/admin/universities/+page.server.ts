import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { University, UniversityMember } from '$lib/types';
import { toPlainArray } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  const search = url.searchParams.get('search') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 20;
  const skip = (page - 1) * limit;

  const db = mongo.db();

  // Build search query
  const searchQuery: Record<string, unknown> = {};
  if (search.trim()) {
    searchQuery.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { nameEn: { $regex: search.trim(), $options: 'i' } },
      { description: { $regex: search.trim(), $options: 'i' } }
    ];
  }

  // For site admins, show all universities
  // For university admins, only show their own university
  if (session.user.userType !== 'site_admin') {
    // Get user's university admin/moderator affiliations
    const memberships = await db
      .collection<UniversityMember>('university_members')
      .find({
        userId: session.user.id,
        memberType: { $in: ['admin', 'moderator'] }
      })
      .map((m: { universityId: string }) => m.universityId)
      .toArray();

    if (memberships.length > 0) {
      // Restrict results to the universities the user administers/moderates.
      // Preserve any existing $or search criteria.
      searchQuery.id = { $in: memberships };
    } else {
      // User has no university admin/moderator privileges
      return {
        universities: [],
        search,
        currentPage: page,
        hasMore: false
      };
    }
  }

  // Fetch universities with member counts
  const universities = (await db
    .collection<University>('universities')
    .aggregate(
      [
        { $match: searchQuery },
        {
          $lookup: {
            from: 'university_members',
            localField: 'id',
            foreignField: 'universityId',
            as: 'members'
          }
        },
        {
          $addFields: {
            membersCount: { $size: '$members' }
          }
        },
        { $sort: { membersCount: -1, clubsCount: -1, name: 1 } },
        { $skip: skip },
        { $limit: limit + 1 } // Fetch one extra to check if there are more
      ],
      {
        collation: { locale: 'zh@collation=gb2312han' }
      }
    )
    .toArray()) as (University & { membersCount: number })[];

  const hasMore = universities.length > limit;
  if (hasMore) {
    universities.pop(); // Remove the extra item
  }

  return {
    universities: toPlainArray(universities),
    search,
    currentPage: page,
    hasMore
  };
};

export const actions: Actions = {
  delete: async ({ request, locals }) => {
    const session = await locals.auth();

    if (!session?.user) {
      return fail(401, { error: 'Unauthorized' });
    }

    // Only site admins can delete universities
    if (session.user.userType !== 'site_admin') {
      return fail(403, { error: 'Access denied' });
    }

    const formData = await request.formData();
    const universityId = formData.get('universityId') as string;

    if (!universityId) {
      return fail(400, { error: 'University ID is required' });
    }

    try {
      const db = mongo.db();

      // Get university details for logging
      const university = await db.collection('universities').findOne({ id: universityId });
      if (!university) {
        return fail(404, { error: 'University not found' });
      }

      // Get all clubs for this university first
      const clubsToDelete = await db
        .collection('clubs')
        .find({ universityId })
        .map((club: Record<string, unknown>) => club.id)
        .toArray();

      // Delete related data in order
      await Promise.all([
        // Delete university members
        db.collection('university_members').deleteMany({ universityId }),
        // Delete clubs associated with this university
        db.collection('clubs').deleteMany({ universityId }),
        // Delete club members for clubs in this university
        db.collection('club_members').deleteMany({
          clubId: { $in: clubsToDelete }
        }),
        // Delete join requests for clubs in this university
        db.collection('join_requests').deleteMany({
          clubId: { $in: clubsToDelete }
        }),
        // Delete invite links for clubs in this university
        db.collection('invite_links').deleteMany({
          clubId: { $in: clubsToDelete }
        })
      ]);

      // Finally delete the university itself
      await db.collection('universities').deleteOne({ id: universityId });

      return { success: true };
    } catch (error) {
      console.error('Error deleting university:', error);
      return fail(500, { error: 'Failed to delete university' });
    }
  }
};
