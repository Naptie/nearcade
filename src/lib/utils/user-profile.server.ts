import type { Db } from 'mongodb';
import type { User } from '$lib/auth/types';
import type { Shop, ShopApi } from '$lib/types';
import { toPlainArray, toPlainObject } from '$lib/utils';
import { toShopApiList } from '$lib/utils/shops/api.server';

/**
 * What a viewer is allowed to see of a profile.
 *
 * The signed-in user and a site administrator see the privacy-controlled
 * fields; every other viewer sees only what the profile owner published.
 */
export interface UserProfileVisibility {
  /** Whether the viewer may see the privacy-controlled fields. */
  canViewAll: boolean;
  /** Whether the profile belongs to the viewer. */
  isOwnProfile: boolean;
}

/**
 * Build the profile payload the user profile endpoints answer with.
 *
 * The university membership, the arcade lists and the email are privacy
 * controlled, so the same payload is assembled from the same reads for every
 * viewer — only the visibility decides what is included. Keeping that in one
 * place is what stops the two endpoints from drifting apart: they used to
 * carry their own copy of these reads, and a field added to one of them was
 * invisible in the other.
 */
export const buildUserProfile = async (
  db: Db,
  user: User,
  { canViewAll, isOwnProfile }: UserProfileVisibility
) => {
  let universityMembership: {
    verifiedAt?: Date;
    joinedAt: Date;
    university: {
      id: string;
      slug?: string;
      name: string;
    };
  } | null = null;

  const universityMembersCollection = db.collection('university_members');
  const universityMembershipCount = await universityMembersCollection.countDocuments({
    userId: user.id
  });
  const clubMembershipCount = await db.collection('club_members').countDocuments({
    userId: user.id
  });

  if (canViewAll || user.isUniversityPublic) {
    const result = await universityMembersCollection
      .aggregate<{
        verifiedAt?: Date;
        joinedAt: Date;
        university: {
          id: string;
          slug?: string;
          name: string;
        };
      }>([
        { $match: { userId: user.id } },
        { $sort: { joinedAt: -1 } },
        { $limit: 1 },
        {
          $lookup: {
            from: 'universities',
            localField: 'universityId',
            foreignField: 'id',
            as: 'university'
          }
        },
        { $unwind: '$university' },
        {
          $project: {
            verifiedAt: 1,
            joinedAt: 1,
            'university.id': 1,
            'university.slug': 1,
            'university.name': 1
          }
        }
      ])
      .toArray();

    if (result.length > 0 && result[0].university) {
      universityMembership = {
        verifiedAt: result[0].verifiedAt,
        joinedAt: result[0].joinedAt,
        university: result[0].university
      };
    }
  }

  let frequentingArcades: ShopApi[] = [];
  let starredArcades: ShopApi[] = [];

  if (canViewAll || user.isFrequentingArcadePublic !== false) {
    const frequentingArcadeIds = user.frequentingArcades || [];
    if (frequentingArcadeIds.length > 0) {
      // The arcade lists are part of a public response, so they are projected
      // onto the public shop shape — the same projection the shop endpoints
      // use. A raw document carries the stored `timezone`, which holds only a
      // name; the contract publishes the computed offset, so the document would
      // not satisfy it.
      const documents = await db
        .collection<Shop>('shops')
        .find({
          id: { $in: frequentingArcadeIds }
        })
        .toArray();
      frequentingArcades = await toShopApiList(documents);
    }
  }

  if (canViewAll || user.isStarredArcadePublic !== false) {
    const starredArcadeIds = user.starredArcades || [];
    if (starredArcadeIds.length > 0) {
      const documents = await db
        .collection<Shop>('shops')
        .find({
          id: { $in: starredArcadeIds }
        })
        .toArray();
      starredArcades = await toShopApiList(documents);
    }
  }

  return toPlainObject({
    user: {
      id: user.id,
      name: user.name,
      displayName: user.displayName,
      image: user.image,
      bio: user.bio,
      userType: user.userType,
      joinedAt: user.joinedAt,
      lastActiveAt: user.lastActiveAt,
      email: canViewAll || user.isEmailPublic ? (user.email ?? null) : null,
      frequentingArcades: toPlainArray(frequentingArcades),
      starredArcades: toPlainArray(starredArcades),
      isActivityPublic: user.isActivityPublic,
      socialLinks: user.socialLinks || []
    },
    frequentingArcadesCount: user.frequentingArcades ? user.frequentingArcades.length : 0,
    starredArcadesCount: user.starredArcades ? user.starredArcades.length : 0,
    universityMembershipCount,
    clubMembershipCount,
    universityMembership,
    isOwnProfile
  });
};
