import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Club, University, UniversityMember } from '$lib/types';
import { checkClubPermission, toPlainArray } from '$lib/utils';
import { PAGINATION } from '$lib/constants';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import meili from '$lib/db/meili.server';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  const user = session.user;

  try {
    const db = mongo.db();

    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '0') || PAGINATION.PAGE_SIZE;
    const skip = (page - 1) * limit;

    const search = url.searchParams.get('search') || '';

    // Build query based on user permissions
    let query: Record<string, unknown> = {};

    if (search) {
      query = {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      };
    }

    // For non-site admins, filter by clubs they can manage
    if (user.userType !== 'site_admin') {
      const clubMembersCollection = db.collection('club_members');
      const userClubMemberships = await clubMembersCollection
        .find({
          userId: user.id,
          memberType: { $in: ['admin', 'moderator'] }
        })
        .toArray();

      const managedClubIds = userClubMemberships.map((m) => m.clubId);

      if (query.$or) {
        query = {
          $and: [{ id: { $in: managedClubIds } }, { $or: query.$or }]
        };
      } else {
        query.id = { $in: managedClubIds };
      }
    }

    // Get clubs
    const clubsCollection = db.collection<Club>('clubs');
    const universitiesCollection = db.collection<University>('universities');

    // Fetch clubs with member counts
    const clubs = (await clubsCollection
      .aggregate([
        { $match: query },
        {
          $lookup: {
            from: 'club_members',
            localField: 'id',
            foreignField: 'clubId',
            as: 'members'
          }
        },
        {
          $addFields: {
            membersCount: { $size: '$members' }
          }
        },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit + 1 }
      ])
      .toArray()) as (Club & { membersCount: number })[];

    const hasMore = clubs.length > limit;
    const clubsToReturn = hasMore ? clubs.slice(0, -1) : clubs;

    // Get university info for clubs
    const universityIds = clubsToReturn.map((club) => club.universityId);
    const universities = await universitiesCollection
      .find({ id: { $in: universityIds } })
      .toArray();

    const universityMap = new Map<string, University>();
    universities.forEach((uni) => universityMap.set(uni.id, uni));

    // Attach university info to clubs
    const enrichedClubs = clubsToReturn.map((club) => ({
      ...club,
      university: universityMap.get(club.universityId) || null
    }));

    // For site admins, show all universities
    // For university admins, only show their own university
    const universityQuery: Record<string, unknown> = {};
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

      universityQuery.id = { $in: memberships };
    }

    // Get all universities for the create modal
    const allUniversities = await universitiesCollection
      .find(universityQuery)
      .sort({ name: 1 })
      .collation({ locale: 'zh@collation=gb2312han' })
      .toArray();

    return {
      clubs: toPlainArray(enrichedClubs),
      universities: toPlainArray(allUniversities),
      hasMore,
      currentPage: page,
      search
    };
  } catch (err) {
    console.error('Error loading clubs:', err);
    return { clubs: [], hasMore: false };
  }
};

export const actions: Actions = {
  delete: async ({ locals, request }) => {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const clubId = formData.get('clubId') as string;

      if (!clubId) {
        return fail(400, { message: m.club_id_is_required() });
      }

      const db = mongo.db();

      // Check permissions
      let hasPermission = false;
      if (session.user.userType === 'site_admin') {
        hasPermission = true;
      } else {
        const permissions = await checkClubPermission(session.user, clubId, mongo);
        hasPermission = permissions.canManage;
      }

      if (!hasPermission) {
        return fail(403, { message: m.insufficient_permissions() });
      }

      // Delete club and related data
      const clubsCollection = db.collection('clubs');
      const clubMembersCollection = db.collection('club_members');
      const joinRequestsCollection = db.collection('join_requests');
      const inviteLinksCollection = db.collection('invite_links');

      await Promise.all([
        clubsCollection.deleteOne({ id: clubId }),
        clubMembersCollection.deleteMany({ clubId: clubId }),
        joinRequestsCollection.deleteMany({ type: 'club', targetId: clubId }),
        inviteLinksCollection.deleteMany({ type: 'club', targetId: clubId }),
        meili.index<Club>('clubs').deleteDocument(clubId)
      ]);

      return { success: true };
    } catch (err) {
      console.error('Error deleting club:', err);
      return fail(500, { message: m.failed_to_delete_club() });
    }
  }
};
