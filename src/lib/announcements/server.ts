import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import type { MongoClient } from 'mongodb';
import mongo from '$lib/db/index.server';
import type { User } from '$lib/auth/types';
import type { Announcement, AnnouncementWithAuthor } from '$lib/types';
import { protect, toPlainArray, toPlainObject } from '$lib/utils';
import {
  ANNOUNCEMENT_PAGE_SIZE,
  ANNOUNCEMENT_READ_COOKIE,
  ANNOUNCEMENT_READ_MAX_AGE,
  EMPTY_ANNOUNCEMENT_READ_STATE,
  type AnnouncementReadState,
  type AnnouncementVisibility,
  isAnnouncementUnread,
  markAllAnnouncementsRead,
  markAnnouncementRead,
  mergeReadStates,
  normalizeReadState
} from './read';

const READ_STATE_COLLECTION = 'announcement_read_state';
const ANNOUNCEMENTS_COLLECTION = 'announcements';

interface AnnouncementReadDocument {
  userId: string;
  readThroughAt: Date | null;
  readTokens: string[];
}

export const announcementReadCookieOptions = {
  path: '/',
  maxAge: ANNOUNCEMENT_READ_MAX_AGE,
  sameSite: 'lax' as const,
  httpOnly: true,
  secure: !dev
};

export const announcementCollection = () =>
  mongo.db().collection<Announcement>(ANNOUNCEMENTS_COLLECTION);

export const canManageAnnouncements = (user?: Pick<User, 'userType'> | null) =>
  user?.userType === 'site_admin';

export const encodeAnnouncementReadCookie = (state: AnnouncementReadState) => {
  const normalized = normalizeReadState(state);
  return Buffer.from(
    JSON.stringify({
      t: normalized.readThroughAt ? new Date(normalized.readThroughAt).getTime() : 0,
      tokens: normalized.readTokens
    }),
    'utf8'
  ).toString('base64url');
};

export const decodeAnnouncementReadCookie = (value: string | undefined | null) => {
  if (!value) return EMPTY_ANNOUNCEMENT_READ_STATE;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      t?: unknown;
      tokens?: unknown;
    };
    return normalizeReadState({
      readThroughAt:
        typeof parsed.t === 'number' && parsed.t > 0 ? new Date(parsed.t).toISOString() : null,
      readTokens: Array.isArray(parsed.tokens) ? parsed.tokens : []
    });
  } catch {
    return EMPTY_ANNOUNCEMENT_READ_STATE;
  }
};

const readCookieState = (cookies: Cookies) =>
  decodeAnnouncementReadCookie(cookies.get(ANNOUNCEMENT_READ_COOKIE));

const writeCookieState = (cookies: Cookies, state: AnnouncementReadState) => {
  const normalized = normalizeReadState(state);
  if (!normalized.readThroughAt && normalized.readTokens.length === 0) {
    cookies.delete(ANNOUNCEMENT_READ_COOKIE, { path: '/' });
    return;
  }
  cookies.set(
    ANNOUNCEMENT_READ_COOKIE,
    encodeAnnouncementReadCookie(normalized),
    announcementReadCookieOptions
  );
};

export const publicAnnouncementFilter = (now = new Date(), includeExpired = true) => {
  const filter: Record<string, unknown> = {
    status: 'published',
    publishedAt: { $lte: now }
  };
  if (!includeExpired) {
    filter.$or = [
      { expiresAt: { $exists: false } },
      { expiresAt: null },
      { expiresAt: { $gt: now } }
    ];
  }
  return filter;
};

const stateFromDocument = (document: AnnouncementReadDocument | null): AnnouncementReadState =>
  normalizeReadState(
    document
      ? {
          readThroughAt: document.readThroughAt ? document.readThroughAt.toISOString() : null,
          readTokens: document.readTokens
        }
      : EMPTY_ANNOUNCEMENT_READ_STATE
  );

const loadUserReadState = async (userId: string) => {
  const document = await mongo
    .db()
    .collection<AnnouncementReadDocument>(READ_STATE_COLLECTION)
    .findOne({ userId });
  return stateFromDocument(document);
};

const saveUserReadState = async (userId: string, state: AnnouncementReadState) => {
  const normalized = normalizeReadState(state);
  await mongo
    .db()
    .collection<AnnouncementReadDocument>(READ_STATE_COLLECTION)
    .updateOne(
      { userId },
      {
        $set: {
          userId,
          readThroughAt: normalized.readThroughAt ? new Date(normalized.readThroughAt) : null,
          readTokens: normalized.readTokens
        }
      },
      { upsert: true }
    );
  return normalized;
};

export const getViewerAnnouncementReadState = async (event: {
  cookies: Cookies;
  locals: App.Locals;
}) => {
  const cookieState = readCookieState(event.cookies);
  const userId = event.locals.user?.id;
  if (!userId) return cookieState;

  const userState = await loadUserReadState(userId);
  if (!cookieState.readThroughAt && cookieState.readTokens.length === 0) return userState;

  const merged = mergeReadStates(userState, cookieState);
  await saveUserReadState(userId, merged);
  event.cookies.delete(ANNOUNCEMENT_READ_COOKIE, { path: '/' });
  return merged;
};

export const countUnreadAnnouncements = async (state: AnnouncementReadState, now = new Date()) => {
  const through = state.readThroughAt ? new Date(state.readThroughAt) : new Date(0);
  const candidates = await announcementCollection()
    .find(
      {
        ...publicAnnouncementFilter(now, false),
        publishedAt: { $gt: through, $lte: now }
      },
      { projection: { id: 1, status: 1, publishedAt: 1, expiresAt: 1 } }
    )
    .toArray();
  return candidates.filter((announcement) => isAnnouncementUnread(announcement, state, now)).length;
};

export const applyAnnouncementRead = async (
  event: { cookies: Cookies; locals: App.Locals },
  input: {
    announcement?: AnnouncementVisibility | null;
    all?: boolean;
  }
) => {
  const now = new Date();
  let state = await getViewerAnnouncementReadState(event);
  if (input.announcement?.publishedAt) state = markAnnouncementRead(state, input.announcement, now);
  if (input.all) state = markAllAnnouncementsRead(state, now);

  const userId = event.locals.user?.id;
  if (userId) {
    state = await saveUserReadState(userId, state);
    event.cookies.delete(ANNOUNCEMENT_READ_COOKIE, { path: '/' });
  } else {
    writeCookieState(event.cookies, state);
  }

  return {
    state,
    unreadCount: await countUnreadAnnouncements(state, now)
  };
};

const authorLookup = [
  {
    $lookup: {
      from: 'users',
      localField: 'createdBy',
      foreignField: 'id',
      as: 'authorData'
    }
  },
  { $addFields: { author: { $arrayElemAt: ['$authorData', 0] } } },
  { $project: { authorData: 0 } }
];

export const listAnnouncements = async ({
  page = 1,
  includeUnpublished = false,
  search = '',
  state,
  now = new Date()
}: {
  page?: number;
  includeUnpublished?: boolean;
  search?: string;
  state: AnnouncementReadState;
  now?: Date;
}) => {
  const skip = (page - 1) * ANNOUNCEMENT_PAGE_SIZE;
  const filter: Record<string, unknown> = includeUnpublished
    ? {}
    : publicAnnouncementFilter(now, true);
  if (search.trim()) {
    const searchRegex = { $regex: search.trim(), $options: 'i' };
    filter.$and = [{ $or: [{ title: searchRegex }, { content: searchRegex }] }];
  }

  const announcements = await announcementCollection()
    .aggregate<AnnouncementWithAuthor>([
      { $match: filter },
      ...authorLookup,
      {
        $sort: includeUnpublished
          ? { createdAt: -1 }
          : { isPinned: -1, publishedAt: -1, createdAt: -1 }
      },
      { $skip: skip },
      { $limit: ANNOUNCEMENT_PAGE_SIZE + 1 }
    ])
    .toArray();

  const hasMore = announcements.length > ANNOUNCEMENT_PAGE_SIZE;
  if (hasMore) announcements.pop();

  return {
    announcements: toPlainArray(
      announcements.map((announcement) => ({
        ...announcement,
        author: protect(announcement.author),
        unread: isAnnouncementUnread(announcement, state, now)
      }))
    ),
    hasMore,
    page
  };
};

export const findAnnouncement = async (id: string) => {
  const [announcement] = await announcementCollection()
    .aggregate<AnnouncementWithAuthor>([{ $match: { id } }, ...authorLookup])
    .toArray();
  return announcement
    ? toPlainObject({ ...announcement, author: protect(announcement.author) })
    : null;
};

export { mongo };
export type { MongoClient };
