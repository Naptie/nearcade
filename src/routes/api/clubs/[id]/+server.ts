import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { Club, University, Shop, ClubMember, UniversityMember } from '$lib/types';
import {
  getClubMembersWithUserData,
  checkClubPermission,
  canWriteClubPosts,
  toPlainArray,
  toPlainObject
} from '$lib/utils';
import { PAGINATION } from '$lib/constants';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { clubDetailResponseSchema, clubIdParamSchema } from '$lib/schemas/organizations';
import {
  normalizeClubDocument,
  normalizeUniversityDocument
} from '$lib/utils/organizations.server';
import { parseParamsOrError } from '$lib/utils/validation.server';

export const GET: RequestHandler = async ({ params, locals }) => {
  const { id } = parseParamsOrError(clubIdParamSchema, params);
  const session = locals.session;

  try {
    const db = mongo.db();
    const clubsCollection = db.collection<Club>('clubs');
    const membersCollection = db.collection<ClubMember>('club_members');
    const universitiesCollection = db.collection<University>('universities');
    const universityMembersCollection = db.collection<UniversityMember>('university_members');
    const shopsCollection = db.collection<Shop>('shops');

    let club = await clubsCollection.findOne({ id });

    if (!club) {
      club = await clubsCollection.findOne({ slug: id });
    }

    if (!club) {
      error(404, m.club_not_found());
    }

    const userPermissions = session?.user
      ? await checkClubPermission(session.user, club, mongo)
      : { canEdit: false, canManage: false, canJoin: 0 as const };

    const university = await universitiesCollection.findOne({ id: club.universityId });

    const universityMembership = session?.user
      ? await universityMembersCollection.findOne({
          universityId: club.universityId,
          userId: session.user.id
        })
      : null;

    const totalMembers = await membersCollection.countDocuments({ clubId: club.id });

    const members = await getClubMembersWithUserData(club.id, mongo, {
      limit: PAGINATION.PAGE_SIZE,
      userFilter: universityMembership?.memberType
        ? {}
        : {
            isUniversityPublic: true
          }
    });

    let starredArcades: Shop[] = [];
    if (club.starredArcades && club.starredArcades.length > 0) {
      const arcades = club.starredArcades.filter((arcade) => !isNaN(arcade));

      if (arcades.length > 0) {
        starredArcades = toPlainArray(
          await shopsCollection
            .find({ id: { $in: arcades } })
            .limit(PAGINATION.PAGE_SIZE)
            .toArray()
        );
      }
    }

    club.membersCount = totalMembers;

    const normalizedClub = normalizeClubDocument(club);
    const normalizedUniversity = university ? normalizeUniversityDocument(university) : null;

    return json(
      clubDetailResponseSchema.parse(
        toPlainObject({
          club: normalizedClub,
          university: normalizedUniversity,
          members,
          starredArcades,
          stats: {
            totalMembers
          },
          userPermissions,
          canWritePosts: await canWriteClubPosts(userPermissions, club, session?.user, mongo)
        })
      )
    );
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading club:', err);
    error(500, m.failed_to_load_club_data());
  }
};
