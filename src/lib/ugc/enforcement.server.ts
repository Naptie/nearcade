import mongo from '$lib/db/index.server';
import { ObjectId } from 'mongodb';
import type { Club, Comment, CommentVote, Post, PostVote, University } from '$lib/types';
import { notify } from '$lib/notifications/index.server';
import { deleteImagesByIds } from '$lib/images/index.server';
import { normalizeUgcText, ugcTextHash } from './hash';
import { ugcEntriesCollection } from './entries.server';
import {
  UGC_TYPES_BY_KIND,
  ugcTypeKind,
  type UgcContentType,
  type UgcEntryRecord,
  type UgcKind
} from './types';

/**
 * Moderation enforcement: turn a moderation decision (LLM verdict, prefilter
 * block, or a human moderator's call) into real effects. The registry is
 * content-addressed, so a `block` for a hash removes/clears every occurrence
 * still carrying that text; a manual action acts on the selected occurrence.
 *
 * Whole-content families (comment / post / delete_request / attendance_report)
 * delete the entity outright; data-bearing families (shop / organization /
 * user bio) clear only the offending field(s) of the live document. The
 * author receives a SYSTEM notification whose noun is the precise content
 * type (see `ugcTypeLabel`).
 */

/** System actor used for moderation-initiated deletions and notifications. */
const SYSTEM_ACTOR = { userId: 'system', userType: 'site_admin' as const };

export interface EnforceOptions {
  reviewedBy?: string | null;
  reason?: string;
  notifyAuthor?: boolean;
}

/** Families whose enforcement deletes the whole content entity (not one field). */
const WHOLE_CONTENT_KINDS = new Set<UgcKind>([
  'comment',
  'post',
  'delete_request',
  'attendance_report'
]);

const deleteCommentThread = async (commentId: string): Promise<void> => {
  const db = mongo.db();
  const commentsCollection = db.collection<Comment>('comments');

  const thread = await commentsCollection
    .find({ $or: [{ id: commentId }, { parentCommentId: commentId }] })
    .project({ id: 1, images: 1, postId: 1 })
    .toArray();
  const threadIds = thread.map((c) => c.id);
  const imageIds = thread.flatMap((c) => c.images ?? []);

  if (imageIds.length > 0) {
    await deleteImagesByIds(db, imageIds, { ...SYSTEM_ACTOR, skipPermissionCheck: true });
  }
  await commentsCollection.deleteMany({ id: { $in: threadIds } });
  await db.collection<CommentVote>('comment_votes').deleteMany({ commentId: { $in: threadIds } });

  const postId = thread.find((c) => c.postId)?.postId;
  if (postId) {
    await db
      .collection<Post>('posts')
      .updateOne(
        { id: postId },
        { $inc: { commentCount: -thread.length }, $set: { updatedAt: new Date() } }
      );
  }
};

const deletePostThread = async (postId: string): Promise<void> => {
  const db = mongo.db();
  const comments = await db
    .collection<Comment>('comments')
    .find({ postId })
    .project({ id: 1, images: 1 })
    .toArray();
  const post = await db
    .collection<Post>('posts')
    .findOne({ id: postId }, { projection: { images: 1 } });

  const imageIds = [...(post?.images ?? []), ...comments.flatMap((c) => c.images ?? [])];
  if (imageIds.length > 0) {
    await deleteImagesByIds(db, imageIds, { ...SYSTEM_ACTOR, skipPermissionCheck: true });
  }
  await db.collection<Comment>('comments').deleteMany({ postId });
  await db.collection<CommentVote>('comment_votes').deleteMany({ postId });
  await db.collection<PostVote>('post_votes').deleteMany({ postId });
  await db.collection<Post>('posts').deleteOne({ id: postId });
};

/** Fetch the live entity behind an occurrence row's family + refId, or null
 * when it's gone. `kind` here is the coarse family (ugcTypeKind(type)). */
const loadLiveEntity = async (
  kind: UgcKind,
  refId: string
): Promise<Record<string, unknown> | null> => {
  const db = mongo.db();
  if (kind === 'organization') {
    const club = await db.collection<Club>('clubs').findOne({ id: refId });
    if (club) return club as unknown as Record<string, unknown>;
    return (await db
      .collection<University>('universities')
      .findOne({ id: refId })) as unknown as Record<string, unknown> | null;
  }
  if (kind === 'attendance_report') {
    // refId is the attendance report's own ObjectId (hex).
    return (await db
      .collection('attendance_reports')
      .findOne({ _id: new ObjectId(refId) })) as Record<string, unknown> | null;
  }
  if (kind === 'comment') {
    return (await db.collection<Comment>('comments').findOne({ id: refId })) as unknown as Record<
      string,
      unknown
    > | null;
  }
  if (kind === 'post') {
    return (await db.collection<Post>('posts').findOne({ id: refId })) as unknown as Record<
      string,
      unknown
    > | null;
  }
  if (kind === 'delete_request') {
    return (await db.collection('shop_delete_requests').findOne({ id: refId })) as Record<
      string,
      unknown
    > | null;
  }
  if (kind === 'user') {
    // refId is the user's Mongo ObjectId (hex); fall back to the `id` field.
    const users = db.collection('users');
    let doc: Record<string, unknown> | null;
    try {
      doc = (await users.findOne({ _id: new ObjectId(refId) })) as Record<string, unknown> | null;
    } catch {
      doc = null;
    }
    return doc ?? ((await users.findOne({ id: refId })) as Record<string, unknown> | null);
  }
  // shop
  return (await db.collection('shops').findOne({ id: Number(refId) || refId })) as Record<
    string,
    unknown
  > | null;
};

/** Live attribute name on a game object for each `game_*` content type. */
const GAME_FIELD_BY_TYPE: Record<string, string> = {
  game_name: 'name',
  game_version: 'version',
  game_cost: 'cost',
  game_description: 'comment'
};

/** Live text for one occurrence row (type + optional key). */
const liveFieldText = (
  type: UgcContentType,
  doc: Record<string, unknown>,
  key?: string
): string | null => {
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');
  switch (type) {
    case 'shop_name':
      return text(doc.name);
    case 'shop_description':
      return text(doc.comment);
    case 'shop_address':
      return text((doc.address as { detailed?: string } | undefined)?.detailed);
    case 'game_name':
    case 'game_version':
    case 'game_cost':
    case 'game_description': {
      if (!key) return null;
      const game = ((doc.games as Record<string, unknown>[] | undefined) ?? []).find(
        (g) => String(g.gameId) === key
      );
      return game ? text(game[GAME_FIELD_BY_TYPE[type]]) : null;
    }
    case 'organization_description':
      return text(doc.description);
    case 'comment':
      return text(doc.content);
    case 'post':
      return key === 'title' ? text(doc.title) : key === 'content' ? text(doc.content) : null;
    case 'delete_request':
      return text(doc.reason);
    case 'attendance_report':
      return text(doc.comment);
    case 'bio':
      return text(doc.bio);
    default:
      return null;
  }
};

/** Clear one occurrence's field on a live shop document (type + game key). */
const clearShopField = async (
  shopId: number | string,
  type: UgcContentType,
  key?: string
): Promise<boolean> => {
  const db = mongo.db();
  const shop = await db.collection('shops').findOne({ id: Number(shopId) || shopId });
  if (!shop) return false;
  const unset: Record<string, true> = {};
  const set: Record<string, string> = {};
  let arrayFilters: { 'g.gameId': number }[] = [];
  if (type === 'shop_name') unset['name'] = true;
  else if (type === 'shop_description') unset['comment'] = true;
  else if (type === 'shop_address') unset['address.detailed'] = true;
  else {
    const attribute = GAME_FIELD_BY_TYPE[type];
    if (!attribute || !key) return false;
    const parsedId = Number(key);
    if (!Number.isFinite(parsedId)) return false;
    set[`games.$[g].${attribute}`] = '';
    arrayFilters = [{ 'g.gameId': parsedId }];
  }
  const update: Record<string, unknown> = {
    ...(Object.keys(unset).length ? { $unset: unset } : {}),
    ...(Object.keys(set).length ? { $set: set } : {})
  };
  await db
    .collection('shops')
    .updateOne(
      { id: shop.id },
      update as never,
      arrayFilters.length > 0 ? ({ arrayFilters } as never) : undefined
    );
  return true;
};

/**
 * Mask a removed source text before it is ever stored on a notification:
 * keep the first and last character, turn everything in between into
 * asterisks; text shorter than 3 characters keeps only the first character.
 * Masking happens at write time so the verbatim source is never persisted or
 * shown to the author again — enough remains to recognise what was removed.
 */
const maskRemovedSource = (text: string): string => {
  const chars = Array.from(text.trim());
  if (chars.length === 0) return '';
  if (chars.length < 3) return chars[0] + '*'.repeat(chars.length - 1);
  return chars[0] + '*'.repeat(chars.length - 2) + chars[chars.length - 1];
};

const notifyRemoval = async (
  entry: UgcEntryRecord,
  reason: string,
  reviewedBy: string | null,
  sourceText: string,
  extraNav: Record<string, string | number | undefined> = {}
): Promise<void> => {
  if (!entry.createdBy) return;
  await notify({
    type: 'SYSTEM',
    actorUserId: SYSTEM_ACTOR.userId,
    actorName: 'nearcade',
    targetUserId: entry.createdBy,
    // The offending source text, masked at write time (never stored verbatim).
    content: maskRemovedSource(sourceText),
    reason,
    reviewedBy: reviewedBy ?? undefined,
    // The coarse family drives the client's deep-link logic…
    kind: ugcTypeKind(entry.type),
    // …while the precise content type feeds the message noun ({type}).
    contentType: entry.type,
    refId: entry.refId,
    ...extraNav
  });
};

/**
 * Enforce a set of occurrence rows (already decided `block`, or a manual
 * removal): remove/clear the underlying live content, then mark the rows
 * `removed`. Whole-content kinds delete the entity; data-bearing kinds clear
 * only fields whose live text still matches the row's hash.
 */
const enforceRows = async (
  rows: UgcEntryRecord[],
  options: EnforceOptions = {}
): Promise<number> => {
  if (rows.length === 0) return 0;
  const { reviewedBy = null, notifyAuthor = true } = options;
  const db = mongo.db();
  // Rows passed in here share one entity (family derived from the precise
  // type + refId — see enforceUgcHash's grouping).
  const kind = ugcTypeKind(rows[0].type);
  const refId = rows[0].refId;
  const reason = options.reason ?? rows[0].auditReason ?? '';
  let removedSomething = false;
  let shopId: number | undefined;

  try {
    const live = await loadLiveEntity(kind, refId);

    // Only act on rows whose content is still present on the live entity
    // (the author may have edited it since the verdict).
    const stillLive: UgcEntryRecord[] = [];
    for (const row of rows) {
      const raw = live ? liveFieldText(row.type, live, row.key) : null;
      if (typeof raw !== 'string' || !raw) continue;
      const normalized = normalizeUgcText(raw);
      if (normalized && (await ugcTextHash(normalized)) === row.hash) stillLive.push(row);
    }

    if (kind === 'comment') {
      if (stillLive.length > 0) {
        await deleteCommentThread(refId);
        removedSomething = true;
      }
    } else if (kind === 'post') {
      if (stillLive.length > 0) {
        await deletePostThread(refId);
        removedSomething = true;
      }
    } else if (kind === 'delete_request') {
      if (stillLive.length > 0) {
        await db.collection('shop_delete_requests').deleteOne({ id: refId });
        removedSomething = true;
      }
    } else if (kind === 'attendance_report') {
      if (stillLive.length > 0) {
        const report = live as { shopId?: unknown } | null;
        if (typeof report?.shopId === 'number') shopId = report.shopId;
        try {
          await db.collection('attendance_reports').deleteOne({ _id: new ObjectId(refId) });
          removedSomething = true;
        } catch {
          // Invalid refId — entity already gone.
        }
      }
    } else if (kind === 'organization') {
      if (stillLive.length > 0) {
        const isClub = await db
          .collection<Club>('clubs')
          .findOne({ id: refId }, { projection: { _id: 1 } });
        await (isClub
          ? db.collection<Club>('clubs').updateOne({ id: refId }, { $unset: { description: '' } })
          : db
              .collection<University>('universities')
              .updateOne({ id: refId }, { $unset: { description: '' } }));
        removedSomething = true;
      }
    } else if (kind === 'shop') {
      for (const row of stillLive) {
        await clearShopField(refId, row.type, row.key);
        removedSomething = true;
      }
    } else if (kind === 'user') {
      // Profile bio — clear the field on the user document.
      if (stillLive.length > 0) {
        let filter: Record<string, unknown>;
        try {
          filter = { _id: new ObjectId(refId) };
        } catch {
          filter = { id: refId };
        }
        const result = await db.collection('users').updateOne(filter, { $unset: { bio: '' } });
        removedSomething = result.modifiedCount > 0;
      }
    }

    // Whole-content kinds take the whole entity (all its rows) with them;
    // data-bearing families only mark the offending occurrence rows.
    const wholeContent = WHOLE_CONTENT_KINDS.has(kind);
    const markIds = wholeContent
      ? (
          await ugcEntriesCollection()
            .find(
              {
                refId,
                type: { $in: [...UGC_TYPES_BY_KIND[kind]] },
                auditStatus: { $ne: 'removed' }
              },
              { projection: { _id: 1 } }
            )
            .toArray()
        ).map((row) => row._id)
      : rows.filter((row) => row.auditStatus !== 'removed').map((row) => row._id);
    const now = new Date();
    await ugcEntriesCollection().updateMany(
      { _id: { $in: markIds } },
      {
        $set: {
          auditStatus: 'removed',
          auditReason: reason || 'manual_removal',
          reviewedBy,
          reviewedAt: now,
          updatedAt: now
        }
      }
    );

    if (notifyAuthor && removedSomething) {
      const nav: Record<string, string | number | undefined> =
        kind === 'attendance_report'
          ? { shopId }
          : kind === 'shop'
            ? { shopId: Number(refId) || undefined }
            : {};
      // The offending text as the author wrote it — read off the in-memory
      // `live` snapshot (still present after whole-content deletion), falling
      // back to the registry's normalized copy. Masked before it is stored.
      const rawSource = live
        ? (liveFieldText(rows[0].type, live, rows[0].key) ?? rows[0].text)
        : rows[0].text;
      await notifyRemoval(rows[0], reason, reviewedBy, rawSource, nav);
    }
    return markIds.length;
  } catch (err) {
    console.error(`[UGCEnforce] Failed to enforce ${kind}/${refId}:`, err);
    return 0;
  }
};

/**
 * Enforce every occurrence carrying a content hash (content-addressed).
 * Auto-block paths call this after the verdict was applied (rows are
 * `block`); manual "remove all with same hash" calls it with rows in any
 * status. `removed` rows stay terminal either way.
 */
export const enforceUgcHash = async (
  hash: string,
  options: EnforceOptions = {}
): Promise<number> => {
  const rows = await ugcEntriesCollection()
    .find({ hash, auditStatus: { $ne: 'removed' } })
    .toArray();
  let affected = 0;
  const groups = new Map<string, UgcEntryRecord[]>();
  for (const row of rows) {
    const key = `${ugcTypeKind(row.type)}:${row.refId}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  for (const group of groups.values()) {
    affected += await enforceRows(group, options);
  }
  return affected;
};

/**
 * Manual moderator removal of one occurrence (and its entity when applicable).
 * Returns the number of registry rows actually flipped to `removed` (sibling
 * rows of whole-content entities count too), so admin UIs can report an
 * accurate "affected" number.
 */
export const enforceUgcEntry = async (
  occurrenceId: string,
  options: EnforceOptions = {}
): Promise<number> => {
  const row = await ugcEntriesCollection().findOne({ _id: occurrenceId });
  if (!row) return 0;
  return enforceRows([row], options);
};
