/**
 * Who may read and act on a post.
 *
 * A post lives inside an organisation — a university or a club — and every
 * endpoint that touches a post has to answer the same two questions about the
 * caller: may they read the post, and may they act on it? Both answers are
 * decided by the organisation the post belongs to, so the organisation lookup
 * and the permission lookup that follows it are written once here instead of
 * once per endpoint.
 *
 * The endpoints do not ask the same question, so the difference stays explicit
 * in the gate list the caller passes in:
 *
 * - the post detail only asks about reading, because a locked post stays
 *   readable — it is the interaction that freezes;
 * - voting on a post and voting on a comment ask about reading first and about
 *   the lock second, so an unreadable post is reported before the lock is even
 *   looked at;
 * - commenting asks about writing — whether the organisation lets the caller
 *   post in it at all — and only then about the lock.
 *
 * The post itself is *not* loaded here: the endpoints read it differently (the
 * detail aggregates the author along with it) and all of them need its fields
 * for other reasons anyway.
 */
import type { Db, MongoClient } from 'mongodb';
import type { User } from '$lib/auth/types';
import { m } from '$lib/paraglide/messages';
import type { Club, PostReadability, University } from '$lib/types';
import {
  canReadPost,
  canWriteClubPosts,
  canWriteUnivPosts,
  checkClubPermission,
  checkUniversityPermission
} from '$lib/utils';

/** The caller, as far as a post permission check is concerned. */
export type PostViewer = User | undefined;

/** The part of a post the permission checks look at. */
export type PostAccessSubject = {
  universityId?: string;
  clubId?: string;
  readability: PostReadability;
  isLocked?: boolean;
};

/** The organisation a post belongs to. */
export type PostOrganization =
  { kind: 'university'; university: University } | { kind: 'club'; club: Club };

/** The caller's standing inside the organisation that owns the post. */
export type PostOrganizationPermissions = {
  canEdit: boolean;
  canManage: boolean;
  canJoin: 0 | 1 | 2;
  role?: string;
};

/** The questions a caller has to be let through before an action is taken. */
export type PostAccessGate = 'read' | 'write' | 'lock';

/** The outcome of the access check. */
export type PostAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'not_readable' | 'not_writable' | 'locked';
      /** The message the endpoint answers the denial with. */
      message: string;
    };

export type PostAccessRequest = {
  /** The post the caller wants to read or act on. */
  post: PostAccessSubject;
  /** The caller; `undefined` for an anonymous request. */
  viewer: PostViewer;
  /** The database the organisation documents live in. */
  db: Db;
  /** The client the membership lookups run against. */
  client: MongoClient;
  /** The gates to apply, in the order they are checked. */
  gates: PostAccessGate[];
};

/**
 * The organisation a post belongs to, or `null` when it has none.
 *
 * A post belongs to at most one organisation, and a university wins over a
 * club when a document somehow carries both ids — the precedence the
 * permission checks have always used.
 */
export const resolvePostOrganization = async (
  post: Pick<PostAccessSubject, 'universityId' | 'clubId'>,
  db: Db
): Promise<PostOrganization | null> => {
  if (post.universityId) {
    const university = await db
      .collection<University>('universities')
      .findOne({ id: post.universityId });
    return university ? { kind: 'university', university } : null;
  }

  if (post.clubId) {
    const club = await db.collection<Club>('clubs').findOne({ id: post.clubId });
    return club ? { kind: 'club', club } : null;
  }

  return null;
};

/**
 * The caller's permissions inside the organisation that owns the post.
 *
 * A post whose organisation no longer exists grants nothing: without the
 * organisation there is nobody left who could authorise anything.
 */
export const resolvePostOrganizationPermissions = async (
  organization: PostOrganization | null,
  viewer: User,
  client: MongoClient
): Promise<PostOrganizationPermissions> => {
  if (!organization) {
    return { canEdit: false, canManage: false, canJoin: 0 };
  }

  if (organization.kind === 'university') {
    const permissions = await checkUniversityPermission(viewer, organization.university, client);
    return {
      canEdit: permissions.canEdit,
      canManage: permissions.canManage,
      canJoin: permissions.canJoin,
      role: permissions.role
    };
  }

  const permissions = await checkClubPermission(viewer, organization.club, client);
  return {
    canEdit: permissions.canEdit,
    canManage: permissions.canManage,
    canJoin: permissions.canJoin,
    role: permissions.role
  };
};

/**
 * Whether the caller may read the post.
 *
 * The readability of the post decides: a public post is readable by anyone, a
 * university- or club-scoped one only by the members of that organisation.
 */
export const canViewerReadPost = async (
  post: PostAccessSubject,
  viewer: PostViewer,
  client: MongoClient
): Promise<boolean> =>
  canReadPost(
    post.readability,
    { universityId: post.universityId, clubId: post.clubId },
    viewer,
    client
  );

/**
 * Whether the organisation lets the caller post in the place the post lives.
 *
 * This is the organisation's own writability setting, not the post's: a
 * university that only lets its members post keeps everybody else out of the
 * conversation entirely.
 */
export const canViewerWritePost = async (
  post: PostAccessSubject,
  viewer: PostViewer,
  db: Db,
  client: MongoClient
): Promise<boolean> => {
  if (!viewer) return false;

  const organization = await resolvePostOrganization(post, db);
  if (!organization) return false;

  if (organization.kind === 'university') {
    const permissions = await checkUniversityPermission(viewer, organization.university, client);
    return canWriteUnivPosts(permissions, organization.university);
  }

  const permissions = await checkClubPermission(viewer, organization.club, client);
  return canWriteClubPosts(permissions, organization.club, viewer, client);
};

/**
 * Whether the caller may act on the post.
 *
 * A locked post freezes the interaction for everybody except the admins and
 * moderators of the organisation that owns it. An unlocked post never blocks
 * anything, so it costs no lookup at all.
 */
export const canViewerInteractWithPost = async (
  post: PostAccessSubject,
  viewer: PostViewer,
  db: Db,
  client: MongoClient
): Promise<boolean> => {
  if (!post.isLocked) return true;
  if (!viewer) return false;

  const organization = await resolvePostOrganization(post, db);
  const permissions = await resolvePostOrganizationPermissions(organization, viewer, client);
  return permissions.canEdit;
};

/**
 * Decide whether the caller may go on.
 *
 * The gates are checked in the order they are given and the first one that
 * fails ends the decision, so the caller never pays for a lookup it does not
 * need and the answer stays the one the endpoint has always given. Every
 * denial is a 403; only the message differs — a caller that may not read the
 * post and a caller that may not write in it are told the same thing, while a
 * frozen post says so.
 */
export const resolvePostAccess = async ({
  post,
  viewer,
  db,
  client,
  gates
}: PostAccessRequest): Promise<PostAccessDecision> => {
  for (const gate of gates) {
    if (gate === 'read') {
      if (!(await canViewerReadPost(post, viewer, client))) {
        return { allowed: false, reason: 'not_readable', message: m.permission_denied() };
      }
      continue;
    }

    if (gate === 'write') {
      if (!(await canViewerWritePost(post, viewer, db, client))) {
        return { allowed: false, reason: 'not_writable', message: m.permission_denied() };
      }
      continue;
    }

    if (!(await canViewerInteractWithPost(post, viewer, db, client))) {
      return { allowed: false, reason: 'locked', message: m.post_is_locked() };
    }
  }

  return { allowed: true };
};
