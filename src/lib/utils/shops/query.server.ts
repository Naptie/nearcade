/**
 * Shared building blocks for the shop query modules (`changelog.server.ts`,
 * `deleted.server.ts`). Kept separate from both so neither has to import the
 * other's concerns just to reuse a helper.
 */

import type { Document } from 'mongodb';

/** Escape a user-supplied string for safe use inside a `$regex`. */
export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Aggregation stages that resolve the user id held in `field` into a public
 * profile stored as `user`, so every reader projects the same shape.
 */
export const userLookupStages = (field: string): Document[] => [
  {
    $lookup: {
      from: 'users',
      let: { uid: `$${field}` },
      pipeline: [
        { $match: { $expr: { $eq: ['$id', '$$uid'] } } },
        {
          $project: {
            _id: 0,
            id: 1,
            name: 1,
            displayName: 1,
            image: { $ifNull: ['$image', null] }
          }
        }
      ],
      as: 'userArr'
    }
  },
  { $addFields: { user: { $arrayElemAt: ['$userArr', 0] } } },
  { $project: { userArr: 0 } }
];

/**
 * Aggregation expression that renders the same label `getDisplayName` would,
 * computed in MongoDB so facet option labels stay language-neutral and need no
 * post-processing on the client:
 *
 *   displayName -> `@handle` -> raw id
 *
 * Expects the joined user document to be available as `$author`.
 */
export const USER_LABEL_EXPRESSION = {
  $ifNull: [
    '$author.displayName',
    {
      $cond: [
        {
          $and: [
            { $ne: ['$author.name', null] },
            // A name equal to the id means the user never set a handle.
            { $ne: ['$author.name', '$author.id'] }
          ]
        },
        { $concat: ['@', '$author.name'] },
        '$_id'
      ]
    }
  ]
};
