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

/**
 * Moderation-deletion archive (`ugc_deleted_docs`). Whole-content removals
 * (comments/posts/delete requests/attendance reports) delete the live
 * document outright; this archive keeps a verbatim snapshot so a moderator
 * can restore false-positive removals. One document per removal — keyed by
 * the live entity id, latest snapshot wins (re-archiving on every removal).
 */
const ARCHIVE_COLLECTION = 'ugc_deleted_docs';

interface UgcDeletedDocRecord {
  /** Live entity id (`comment:abc`, `post:def`, ...). */
  _id: string;
  kind: UgcKind;
  refId: string;
  /** The archived live document(s) verbatim. */
  docs: Record<string, unknown>[];
  /** Votes + thread siblings snapshotted alongside the main document. */
  related: Record<string, unknown>[];
  relatedCollection: 'comment_votes' | 'post_votes';
  archivedAt: Date;
}

const archiveCollection = () => mongo.db().collection<UgcDeletedDocRecord>(ARCHIVE_COLLECTION);

/**
 * Snapshot a whole-content entity (and its votes/thread siblings) before it
 * is hard-deleted, so `restoreUgcEntries` can put it back verbatim. Best-
 * effort: a snapshot failure must never block the removal itself.
 */
const archiveWholeContent = async (kind: UgcKind, refId: string): Promise<void> => {
  try {
    const db = mongo.db();
    const docs: Record<string, unknown>[] = [];
    let related: Record<string, unknown>[] = [];
    let relatedCollection: UgcDeletedDocRecord['relatedCollection'] = 'comment_votes';

    if (kind === 'comment') {
      const thread = await db
        .collection<Comment>('comments')
        .find({ $or: [{ id: refId }, { parentCommentId: refId }] })
        .toArray();
      docs.push(...thread);
      related = await db
        .collection<CommentVote>('comment_votes')
        .find({ commentId: { $in: thread.map((c) => c.id) } })
        .toArray();
    } else if (kind === 'post') {
      const post = await db.collection<Post>('posts').findOne({ id: refId });
      if (post) docs.push(post);
      const thread = await db.collection<Comment>('comments').find({ postId: refId }).toArray();
      docs.push(...thread);
      related = await db.collection<PostVote>('post_votes').find({ postId: refId }).toArray();
      relatedCollection = 'post_votes';
    } else if (kind === 'delete_request') {
      const request = await db.collection('shop_delete_requests').findOne({ id: refId });
      if (request) docs.push(request);
      related = await db
        .collection<Comment>('comments')
        .find({ shopDeleteRequestId: refId })
        .toArray();
    } else if (kind === 'attendance_report') {
      try {
        const report = await db
          .collection('attendance_reports')
          .findOne({ _id: new ObjectId(refId) });
        if (report) docs.push(report);
      } catch {
        // Invalid refId — nothing to archive.
      }
    } else {
      return; // Data-bearing kinds never archive — fields are just cleared.
    }

    if (docs.length === 0) return;
    await archiveCollection().updateOne(
      { _id: `${kind}:${refId}` },
      {
        $set: {
          kind,
          refId,
          docs,
          related,
          relatedCollection,
          archivedAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (err) {
    console.error(`[UGCEnforce] Failed to archive ${kind}/${refId}:`, err);
  }
};

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
        await archiveWholeContent(kind, refId);
        await deleteCommentThread(refId);
        removedSomething = true;
      }
    } else if (kind === 'post') {
      if (stillLive.length > 0) {
        await archiveWholeContent(kind, refId);
        await deletePostThread(refId);
        removedSomething = true;
      }
    } else if (kind === 'delete_request') {
      if (stillLive.length > 0) {
        await archiveWholeContent(kind, refId);
        await db.collection('shop_delete_requests').deleteOne({ id: refId });
        removedSomething = true;
      }
    } else if (kind === 'attendance_report') {
      if (stillLive.length > 0) {
        const report = live as { shopId?: unknown } | null;
        if (typeof report?.shopId === 'number') shopId = report.shopId;
        try {
          await archiveWholeContent(kind, refId);
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

/** Write one occurrence's text back onto its live entity. Inverse of the
 * field-clearing side of enforcement; returns true when something was
 * written. Whole-content kinds (comments/posts/...) cannot be resurrected —
 * the entity is gone — so they restore nothing. */
const writeBackField = async (
  kind: UgcKind,
  refId: string,
  type: UgcContentType,
  key: string | undefined,
  text: string
): Promise<boolean> => {
  const db = mongo.db();
  if (kind === 'shop') {
    const shop = await db.collection('shops').findOne({ id: Number(refId) || refId });
    if (!shop) return false;
    if (type === 'shop_name') {
      await db.collection('shops').updateOne({ id: shop.id }, { $set: { name: text } });
    } else if (type === 'shop_description') {
      await db.collection('shops').updateOne({ id: shop.id }, { $set: { comment: text } });
    } else if (type === 'shop_address') {
      await db
        .collection('shops')
        .updateOne({ id: shop.id }, { $set: { 'address.detailed': text } });
    } else {
      const attribute = GAME_FIELD_BY_TYPE[type];
      const parsedId = Number(key);
      if (!attribute || !key || !Number.isFinite(parsedId)) return false;
      await db
        .collection('shops')
        .updateOne(
          { id: shop.id, games: { $elemMatch: { gameId: parsedId } } },
          { $set: { [`games.$[g].${attribute}`]: text } } as never,
          [{ 'g.gameId': parsedId }] as never
        );
    }
    return true;
  }
  if (kind === 'organization') {
    const isClub = await db
      .collection<Club>('clubs')
      .findOne({ id: refId }, { projection: { _id: 1 } });
    const result = isClub
      ? await db
          .collection<Club>('clubs')
          .updateOne(
            { id: refId, description: { $in: ['', null] } as never },
            { $set: { description: text } }
          )
      : await db
          .collection<University>('universities')
          .updateOne(
            { id: refId, description: { $in: ['', null] } as never },
            { $set: { description: text } }
          );
    return result.modifiedCount > 0;
  }
  if (kind === 'user') {
    let filter: Record<string, unknown>;
    try {
      filter = { _id: new ObjectId(refId) };
    } catch {
      filter = { id: refId };
    }
    const result = await db
      .collection('users')
      .updateOne({ ...filter, bio: { $in: ['', null] } as never }, { $set: { bio: text } });
    return result.modifiedCount > 0;
  }
  // Whole-content kinds: entity was deleted outright — nothing to write back.
  return false;
};

/**
 * Re-insert an archived whole-content entity (comment/post/delete request/
 * attendance report) after a false-positive removal. The archive snapshot is
 * consumed (deleted) on success; nothing is resurrected when the entity was
 * re-created in the meantime — the author's newer content always wins.
 */
const resurrectWholeContent = async (kind: UgcKind, refId: string): Promise<boolean> => {
  const db = mongo.db();
  const archiveId = `${kind}:${refId}`;
  const archived = await archiveCollection().findOne({ _id: archiveId });
  if (!archived || archived.docs.length === 0) return false;

  const now = new Date();
  try {
    if (kind === 'comment') {
      // Already re-created (or never deleted) — never clobber.
      const existing = await db
        .collection<Comment>('comments')
        .findOne({ id: refId }, { projection: { _id: 1 } });
      if (existing) return false;
      // Skip siblings that already exist (partial re-creation).
      const main = archived.docs.find((d) => d.id === refId);
      if (!main) return false;
      await db.collection<Comment>('comments').insertOne(main as never);
      const siblings = archived.docs.filter((d) => d.id !== refId);
      if (siblings.length > 0) {
        const siblingIds = siblings.map((d) => String(d.id));
        const existingSiblings = await db
          .collection<Comment>('comments')
          .find({ id: { $in: siblingIds } }, { projection: { id: 1 } })
          .toArray();
        const existingSiblingIds = new Set(existingSiblings.map((c) => c.id));
        const toInsert = siblings.filter((d) => !existingSiblingIds.has(String(d.id)));
        if (toInsert.length > 0) {
          await db.collection<Comment>('comments').insertMany(toInsert as never[]);
        }
        // Restore the parent post's comment count.
        const postId = typeof main.postId === 'string' ? main.postId : null;
        if (postId) {
          await db
            .collection<Post>('posts')
            .updateOne(
              { id: postId },
              { $inc: { commentCount: 1 + toInsert.length }, $set: { updatedAt: now } }
            );
        }
      }
      if (archived.related.length > 0 && archived.relatedCollection === 'comment_votes') {
        await db.collection<CommentVote>('comment_votes').insertMany(archived.related as never[]);
      }
    } else if (kind === 'post') {
      const existing = await db
        .collection<Post>('posts')
        .findOne({ id: refId }, { projection: { _id: 1 } });
      if (existing) return false;
      const main = archived.docs.find((d) => d.id === refId);
      if (!main) return false;
      await db.collection<Post>('posts').insertOne(main as never);
      const thread = archived.docs.filter((d) => d.id !== refId);
      if (thread.length > 0) {
        await db.collection<Comment>('comments').insertMany(thread as never[]);
      }
      if (archived.related.length > 0 && archived.relatedCollection === 'post_votes') {
        await db.collection<PostVote>('post_votes').insertMany(archived.related as never[]);
      }
    } else if (kind === 'delete_request') {
      const existing = await db
        .collection('shop_delete_requests')
        .findOne({ id: refId }, { projection: { _id: 1 } });
      if (existing) return false;
      const main = archived.docs[0];
      if (!main) return false;
      await db.collection('shop_delete_requests').insertOne(main as never);
      // Thread comments archived under `related` — restore any missing ones.
      for (const comment of archived.related) {
        const commentId = String(comment.id ?? '');
        if (!commentId) continue;
        const existingComment = await db
          .collection<Comment>('comments')
          .findOne({ id: commentId }, { projection: { _id: 1 } });
        if (!existingComment) {
          await db.collection<Comment>('comments').insertOne(comment as never);
        }
      }
    } else if (kind === 'attendance_report') {
      const existing = await db
        .collection('attendance_reports')
        .findOne({ _id: new ObjectId(refId) });
      if (existing) return false;
      const main = archived.docs[0];
      if (!main) return false;
      await db.collection('attendance_reports').insertOne(main as never);
    } else {
      return false;
    }
  } catch (err) {
    console.error(`[UGCEnforce] Failed to resurrect ${kind}/${refId}:`, err);
    return false;
  }
  await archiveCollection().deleteOne({ _id: archiveId });
  return true;
};

/**
 * Manual restoration of removed content (false-positive intervention):
 *  1. whole-content kinds (comment/post/delete request/attendance report)
 *     are re-inserted verbatim from the removal archive — never when the
 *     entity was re-created in the meantime;
 *  2. data-bearing kinds re-write the removed text back onto live fields,
 *     but ONLY when the live field is empty/absent (i.e. it was merely
 *     cleared by enforcement and never legitimately edited afterwards) —
 *     this never overwrites newer content;
 *  3. flip the removed rows back to `pass` with manual review metadata
 *     (auditReason/categories/score are left untouched — no redundant
 *     overwrite).
 * Returns the number of registry rows restored. Clearing the cached verdict
 * for the hash is the caller's responsibility (see `clearCachedVerdict` in
 * audit.server.ts).
 */
export const restoreUgcEntries = async (
  rows: UgcEntryRecord[],
  reviewedBy: string | null
): Promise<number> => {
  if (rows.length === 0) return 0;
  let restored = 0;
  for (const row of rows) {
    const kind = ugcTypeKind(row.type);
    if (WHOLE_CONTENT_KINDS.has(kind)) {
      await resurrectWholeContent(kind, row.refId);
    } else {
      const live = await loadLiveEntity(kind, row.refId);
      if (live) {
        const raw = liveFieldText(row.type, live, row.key);
        const normalized = typeof raw === 'string' && raw ? normalizeUgcText(raw) : '';
        // Only write back when the live field is empty/absent — a field that
        // still holds (different) text was legitimately edited after removal
        // and must never be clobbered.
        if (!normalized) {
          await writeBackField(kind, row.refId, row.type, row.key, row.text);
        }
      }
    }
    restored++;
  }
  const now = new Date();
  await ugcEntriesCollection().updateMany(
    { _id: { $in: rows.map((row) => row._id) }, auditStatus: 'removed' },
    {
      $set: {
        auditStatus: 'pass' as const,
        auditSource: 'manual' as const,
        reviewedBy,
        reviewedAt: now,
        updatedAt: now
      }
    }
  );
  return restored;
};
