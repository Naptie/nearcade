/**
 * The club detail: one club with its university, its members, the arcades it
 * starred and the permissions the current user has on it.
 */
import { implement } from '@orpc/server';
import { clubsContract } from '../../contracts/clubs';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { toPlainWire } from '../../wire.server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { canWriteClubPosts, checkClubPermission, getClubMembersWithUserData } from '$lib/utils';
import {
  normalizeClubDocument,
  normalizeUniversityDocument
} from '$lib/utils/organizations.server';
import { toShopApiList } from '$lib/utils/shops/api.server';
import { clubDetailResponseSchema } from '$lib/schemas/organizations';
import { PAGINATION } from '$lib/constants';
import {
  type Club,
  type ClubMember,
  type Shop,
  type ShopApi,
  type University,
  type UniversityMember
} from '$lib/types';

const impl = implement(clubsContract).$context<ApiContext>();

export const clubsDetailImplementation = {
  detail: impl.detail.handler(async ({ input, context }) => {
    const { id } = input;
    const session = context.session;

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
        apiError('NOT_FOUND', m.club_not_found());
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

      let starredArcades: ShopApi[] = [];
      if (club.starredArcades && club.starredArcades.length > 0) {
        const arcades = club.starredArcades.filter((arcade) => !isNaN(arcade));

        if (arcades.length > 0) {
          // The list is part of a public response, so it is projected onto the
          // public shop shape — the same projection the shop endpoints use. A
          // raw document carries the stored `timezone`, which holds only a
          // name; the contract publishes the computed offset.
          const documents = await shopsCollection
            .find({ id: { $in: arcades } })
            .limit(PAGINATION.PAGE_SIZE)
            .toArray();
          starredArcades = await toShopApiList(documents);
        }
      }

      club.membersCount = totalMembers;

      const normalizedClub = normalizeClubDocument(club);
      const normalizedUniversity = university ? normalizeUniversityDocument(university) : null;

      return toPlainWire(clubDetailResponseSchema, {
        club: normalizedClub,
        university: normalizedUniversity,
        members,
        starredArcades,
        stats: {
          totalMembers
        },
        userPermissions,
        canWritePosts: await canWriteClubPosts(userPermissions, club, session?.user, mongo)
      });
    } catch (err) {
      rethrowApiError(err, m.failed_to_load_club_data());
    }
  })
};
