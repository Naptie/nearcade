import type { Db } from 'mongodb';
import type {
  Comment,
  CommentWithAuthorAndVote,
  ShopDeleteRequestVote,
  ShopDeleteRequestVoteSummary
} from '$lib/types';
import type { PublicUser, User } from '$lib/auth/types';
import { hydrateEntitiesWithImages } from '$lib/images/index.server';
import { protect } from '$lib/utils';

export const getShopDeleteRequestVoteSummary = async (
  db: Db,
  shopDeleteRequestId: string,
  userId?: string
): Promise<ShopDeleteRequestVoteSummary> => {
  const votesCollection = db.collection<ShopDeleteRequestVote>('shop_delete_request_votes');

  const [counts, currentUserVote] = await Promise.all([
    votesCollection
      .aggregate<{
        _id: ShopDeleteRequestVote['voteType'];
        count: number;
      }>([
        { $match: { shopDeleteRequestId } },
        { $group: { _id: '$voteType', count: { $sum: 1 } } }
      ])
      .toArray(),
    userId
      ? votesCollection.findOne({ shopDeleteRequestId, userId })
      : Promise.resolve<ShopDeleteRequestVote | null>(null)
  ]);

  return {
    favorVotes: counts.find((entry) => entry._id === 'favor')?.count ?? 0,
    againstVotes: counts.find((entry) => entry._id === 'against')?.count ?? 0,
    userVote: currentUserVote?.voteType ?? null
  };
};

export const getShopDeleteRequestComments = async (
  db: Db,
  shopDeleteRequestId: string,
  userId?: string
): Promise<CommentWithAuthorAndVote[]> => {
  const commentsCollection = db.collection<Comment>('comments');

  const comments = await commentsCollection
    .aggregate<CommentWithAuthorAndVote>([
      {
        $match: { shopDeleteRequestId }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'createdBy',
          foreignField: 'id',
          as: 'authorData'
        }
      },
      {
        $lookup: {
          from: 'comment_votes',
          localField: 'id',
          foreignField: 'commentId',
          as: 'commentVoteData'
        }
      },
      {
        $lookup: {
          from: 'shop_delete_request_votes',
          let: { authorId: '$createdBy', requestId: '$shopDeleteRequestId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$userId', '$$authorId'] },
                    { $eq: ['$shopDeleteRequestId', '$$requestId'] }
                  ]
                }
              }
            },
            { $limit: 1 }
          ],
          as: 'authorDeleteRequestVoteData'
        }
      },
      {
        $addFields: {
          author: {
            $arrayElemAt: ['$authorData', 0]
          },
          vote: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$commentVoteData',
                  as: 'vote',
                  cond: { $eq: ['$$vote.userId', userId ?? ''] }
                }
              },
              0
            ]
          },
          authorDeleteRequestVote: {
            $arrayElemAt: ['$authorDeleteRequestVoteData', 0]
          }
        }
      },
      {
        $project: {
          authorData: 0,
          commentVoteData: 0,
          authorDeleteRequestVoteData: 0
        }
      },
      {
        $sort: { createdAt: 1 }
      }
    ])
    .toArray();

  const protectedComments = comments.map((comment) => ({
    ...comment,
    author: protect(comment.author)
  }));

  return hydrateEntitiesWithImages(db, protectedComments);
};

/**
 * Attach the requester's public user profile to each delete request.
 *
 * The denormalized `requestedByName` field only stores `user.name`, which for
 * some accounts falls back to the raw user ID. Resolving the actual user record
 * lets the client render a proper display name via `getDisplayName`.
 */
export const attachDeleteRequestRequesters = async <T extends { requestedBy?: string | null }>(
  db: Db,
  requests: T[]
): Promise<(T & { requestedByUser: PublicUser | null })[]> => {
  const requesterIds = [
    ...new Set(requests.map((request) => request.requestedBy).filter((id): id is string => !!id))
  ];

  const requesterById = new Map<string, PublicUser>();
  if (requesterIds.length > 0) {
    const users = await db
      .collection<User>('users')
      .find({ id: { $in: requesterIds } })
      .toArray();
    for (const user of users) {
      const publicUser = protect(user);
      if (publicUser) {
        requesterById.set(user.id, publicUser);
      }
    }
  }

  return requests.map((request) => ({
    ...request,
    requestedByUser: request.requestedBy ? (requesterById.get(request.requestedBy) ?? null) : null
  }));
};
