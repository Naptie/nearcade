import type { Db } from 'mongodb';
import type {
  Comment,
  CommentWithAuthorAndVote,
  ShopDeleteRequestVote,
  ShopDeleteRequestVoteSummary
} from '$lib/types';
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
      }>([{ $match: { shopDeleteRequestId } }, { $group: { _id: '$voteType', count: { $sum: 1 } } }])
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

  return comments.map((comment) => ({
    ...comment,
    author: protect(comment.author)
  }));
};
