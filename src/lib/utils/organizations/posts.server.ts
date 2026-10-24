/**
 * The organisation post domain.
 *
 * A club and a university both own a feed of posts, and both feeds follow the
 * same two rules: a post is only shown to the readers its own readability
 * setting admits, and only the people the organisation's writability setting
 * allows may post in it. The two organisations are not the same, though — a
 * club may publish a post the whole university can read, a university has no
 * such level — so the organisation kind is a parameter of every operation
 * here instead of two copies of the same code.
 *
 * This is a domain service: it knows nothing about HTTP. A failure is
 * reported as an {@link OrganizationPostError}, and the API layer turns it
 * into the status the endpoint answers with.
 */
import mongo from '$lib/db/index.server';
import { attachImagesToOwner } from '$lib/images/index.server';
import { withExistingImages } from '$lib/images/validation.server';
import { m } from '$lib/paraglide/messages';
import { PAGINATION } from '$lib/constants';
import { postCreateRequestSchema } from '$lib/schemas/posts';
import { type Club, type PostWithAuthor, type University, PostReadability } from '$lib/types';
import type { Post } from '$lib/types/index.server';
import { auditUgc, blockedUgcMessage } from '$lib/ugc/audit.server';
import { submitUgc } from '$lib/ugc/entries.server';
import {
  canReadPost,
  canWriteClubPosts,
  canWriteUnivPosts,
  checkClubPermission,
  checkUniversityPermission,
  getDefaultPostReadability,
  postId,
  protect,
  validatePostReadability
} from '$lib/utils';
import { formatZodError } from '$lib/utils/validation';
import type { User } from '$lib/auth/types';

/** The organisation a post belongs to. */
export type OrganizationKind = 'club' | 'university';

/**
 * The API error code a failure answers with.
 *
 * The service names a failure the way the endpoint that serves it does — a
 * missing organisation is a 404, a refused post is a 403 — so the API layer
 * never has to repeat the mapping.
 */
export type OrganizationPostFailureCode = 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND';

/**
 * A failed organisation-post operation.
 *
 * The message is the one the endpoint answers with; the code is the status
 * it answers with.
 */
export class OrganizationPostError extends Error {
  constructor(
    readonly code: OrganizationPostFailureCode,
    message: string
  ) {
    super(message);
    this.name = 'OrganizationPostError';
  }
}

const postCreateRequestWithExistingImagesSchema = withExistingImages(postCreateRequestSchema);

/**
 * The message for an organisation that does not exist.
 */
const notFoundMessage = (kind: OrganizationKind) =>
  kind === 'club' ? m.club_not_found() : m.university_not_found();

/**
 * The message for a refused readability.
 *
 * The club endpoint has always answered with a fixed English sentence while
 * the university endpoint answers with a localized one. Both are kept as they
 * are: the wording of an error is part of the endpoint's contract.
 */
const readabilityMessage = (kind: OrganizationKind) =>
  kind === 'club'
    ? 'Cannot set post readability more open than organization setting'
    : m.cannot_set_post_readability_more_open_than_organization_setting();

/**
 * The club a route addresses, by id or by slug.
 */
const findClub = (id: string) =>
  mongo
    .db()
    .collection<Club>('clubs')
    .findOne({ $or: [{ id }, { slug: id }] });

/**
 * The university a route addresses, by id or by slug.
 */
const findUniversity = (id: string) =>
  mongo
    .db()
    .collection<University>('universities')
    .findOne({ $or: [{ id }, { slug: id }] });

/**
 * The readability a new post is published with.
 *
 * A post can never be more open than the organisation's own setting, unless
 * the author may set any level. A club may additionally publish a post the
 * whole university can read — a level a university has no use for, because a
 * university post is read by the university in the first place.
 */
const resolvePostReadability = (
  kind: OrganizationKind,
  readability: PostReadability | undefined,
  organizationReadability: PostReadability | undefined,
  permissions: { canEdit: boolean; role?: string },
  userType: string | undefined
): PostReadability => {
  const orgReadability = getDefaultPostReadability(organizationReadability);

  if (readability === undefined) {
    // Use default readability
    return orgReadability;
  }

  // Validate if user can set this readability level
  // Note: For clubs, CLUB_MEMBERS readability is invalid for universities
  if (kind === 'club' && readability === PostReadability.UNIV_MEMBERS) {
    // This is allowed for club posts - it means university members can read
    return readability;
  }

  if (!validatePostReadability(readability, orgReadability, permissions, userType)) {
    throw new OrganizationPostError('FORBIDDEN', readabilityMessage(kind));
  }

  return readability;
};

export interface OrganizationPostListOptions {
  /** The organisation the posts belong to. */
  kind: OrganizationKind;
  /** The organisation's id or slug, as the route carries it. */
  id: string;
  /** The page of posts to return. */
  page: number;
  /** The reader the visibility rules are evaluated for. */
  viewer?: User;
}

export interface OrganizationPostList {
  posts: PostWithAuthor[];
  hasMore: boolean;
  page: number;
}

/**
 * The posts of one organisation, filtered by the readability rules.
 *
 * The filter runs before the pagination: a post the reader may not see is
 * not a post that occupies a slot on the page.
 */
export const listOrganizationPosts = async ({
  kind,
  id,
  page,
  viewer
}: OrganizationPostListOptions): Promise<OrganizationPostList> => {
  const db = mongo.db();
  const postsCollection = db.collection<Post>('posts');
  const skip = (page - 1) * PAGINATION.PAGE_SIZE;

  // Check if the organisation exists
  const organization = kind === 'club' ? await findClub(id) : await findUniversity(id);
  if (!organization) {
    throw new OrganizationPostError('NOT_FOUND', notFoundMessage(kind));
  }

  // Check post readability permissions - now using post-level readability
  // Get posts and filter based on individual post readability
  const allPosts = await postsCollection
    .aggregate<PostWithAuthor>([
      {
        $match: kind === 'club' ? { clubId: organization.id } : { universityId: organization.id }
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
        $addFields: {
          author: {
            $arrayElemAt: ['$authorData', 0]
          }
        }
      },
      {
        $project: {
          authorData: 0
        }
      },
      {
        $sort: { isPinned: -1, createdAt: -1 }
      }
    ])
    .toArray();

  // Filter posts based on readability permissions
  const readablePosts: PostWithAuthor[] = [];
  for (const post of allPosts) {
    const canRead = await canReadPost(
      post.readability,
      { universityId: post.universityId, clubId: post.clubId },
      viewer,
      mongo
    );
    if (canRead) {
      const readablePost = { ...post, author: protect(post.author) };
      readablePosts.push(readablePost);
    }
  }

  // Apply pagination after filtering
  const hasMore = readablePosts.length > skip + PAGINATION.PAGE_SIZE;
  const posts = readablePosts.slice(skip, skip + PAGINATION.PAGE_SIZE);

  return { posts, hasMore, page };
};

export interface OrganizationPostCreateInput {
  title: string;
  content?: string;
  readability?: PostReadability;
  images?: string[];
}

export interface OrganizationPostCreateOptions {
  /** The organisation the post belongs to. */
  kind: OrganizationKind;
  /** The organisation's id or slug, as the route carries it. */
  id: string;
  /** The author of the post. */
  user: User;
  input: OrganizationPostCreateInput;
}

/**
 * Publish a post under one organisation.
 *
 * The body is validated before the organisation is looked up, so a malformed
 * request is answered as such even when it also names an organisation that
 * does not exist.
 */
export const createOrganizationPost = async ({
  kind,
  id,
  user,
  input
}: OrganizationPostCreateOptions): Promise<{ success: true; postId: string }> => {
  // The contract validates the request body; the legacy handler
  // additionally verified that every referenced image exists.
  const parsedBody = await postCreateRequestWithExistingImagesSchema.safeParseAsync({
    title: input.title,
    content: input.content,
    readability: input.readability,
    images: input.images
  });
  if (!parsedBody.success) {
    throw new OrganizationPostError('BAD_REQUEST', formatZodError(parsedBody.error));
  }
  const {
    title: trimmedTitle,
    content: trimmedContent,
    readability,
    images: imageIds
  } = parsedBody.data;

  const db = mongo.db();
  const postsCollection = db.collection<Post>('posts');

  let permissions: { canEdit: boolean; role?: string };
  let organizationReadability: PostReadability | undefined;
  let owner: { clubId: string } | { universityId: string };

  if (kind === 'club') {
    // Check if club exists
    const club = await findClub(id);
    if (!club) {
      throw new OrganizationPostError('NOT_FOUND', notFoundMessage(kind));
    }

    // Check post writability permissions
    const clubPermissions = await checkClubPermission(user, club, mongo);
    if (!(await canWriteClubPosts(clubPermissions, club, user, mongo))) {
      throw new OrganizationPostError('FORBIDDEN', m.permission_denied());
    }

    permissions = clubPermissions;
    organizationReadability = club.postReadability;
    owner = { clubId: club.id };
  } else {
    // Check if university exists
    const university = await findUniversity(id);
    if (!university) {
      throw new OrganizationPostError('NOT_FOUND', notFoundMessage(kind));
    }

    // Check post writability permissions
    const universityPermissions = await checkUniversityPermission(user, university, mongo);
    if (!canWriteUnivPosts(universityPermissions, university)) {
      throw new OrganizationPostError('FORBIDDEN', m.permission_denied());
    }

    permissions = universityPermissions;
    organizationReadability = university.postReadability;
    owner = { universityId: university.id };
  }

  // Determine post readability
  const postReadability = resolvePostReadability(
    kind,
    readability,
    organizationReadability,
    permissions,
    user.userType
  );

  // Create new post
  const newPost: Post = {
    id: postId(),
    title: trimmedTitle,
    content: trimmedContent,
    images: imageIds,
    ...owner,
    createdBy: user.id,
    createdAt: new Date(),
    upvotes: 0,
    downvotes: 0,
    commentCount: 0,
    isPinned: false,
    isLocked: false,
    readability: postReadability
  };

  const blocked = await auditUgc('post', newPost.id, {
    title: newPost.title,
    content: newPost.content ?? ''
  });
  if (blocked) {
    throw new OrganizationPostError('BAD_REQUEST', blockedUgcMessage(blocked));
  }

  await postsCollection.insertOne(newPost);

  try {
    if (imageIds.length > 0) {
      await attachImagesToOwner(
        db,
        imageIds,
        { postId: newPost.id },
        { userId: user.id, userType: user.userType }
      );
    }
  } catch (attachmentError) {
    await postsCollection.deleteOne({ id: newPost.id });
    throw attachmentError;
  }

  // Register entry + queue background pre-translation for the post.
  submitUgc('post', newPost.id, user, {
    title: newPost.title,
    content: newPost.content ?? ''
  });

  return { success: true, postId: newPost.id };
};
