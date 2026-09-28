export const ANNOUNCEMENT_READ_COOKIE = 'announcement_read';
export const ANNOUNCEMENT_READ_MAX_AGE = 60 * 60 * 24 * 400;
export const ANNOUNCEMENT_PAGE_SIZE = 20;
const MAX_READ_TOKENS = 50;
const READ_TOKEN_PATTERN = /^[0-9A-Za-z_-]{8,64}@[0-9]+$/;

export interface AnnouncementReadState {
  readThroughAt: string | null;
  readTokens: string[];
}

export const EMPTY_ANNOUNCEMENT_READ_STATE: AnnouncementReadState = {
  readThroughAt: null,
  readTokens: []
};

export interface AnnouncementVisibility {
  id: string;
  status?: 'draft' | 'published' | string | null;
  publishedAt?: Date | string | null;
  expiresAt?: Date | string | null;
}

const toTime = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export const announcementReadToken = (id: string, publishedAt: Date | string) =>
  `${id}@${new Date(publishedAt).getTime()}`;

export const sanitizeReadTokens = (tokens: unknown) => {
  if (!Array.isArray(tokens)) return [];
  return [
    ...new Set(
      tokens.filter(
        (token): token is string => typeof token === 'string' && READ_TOKEN_PATTERN.test(token)
      )
    )
  ]
    .sort((left, right) => {
      const leftPublishedAt = Number(left.split('@').pop());
      const rightPublishedAt = Number(right.split('@').pop());
      return rightPublishedAt - leftPublishedAt;
    })
    .slice(0, MAX_READ_TOKENS);
};

export const clampReadThroughAt = (value: Date | string | null | undefined, now = new Date()) => {
  const time = toTime(value);
  if (time === null || time <= 0) return null;
  return new Date(Math.min(time, now.getTime())).toISOString();
};

export const normalizeReadState = (
  state: Partial<AnnouncementReadState> | null | undefined,
  now = new Date()
): AnnouncementReadState => ({
  readThroughAt: clampReadThroughAt(state?.readThroughAt, now),
  readTokens: sanitizeReadTokens(state?.readTokens)
});

export const mergeReadStates = (
  left: Partial<AnnouncementReadState> | null | undefined,
  right: Partial<AnnouncementReadState> | null | undefined,
  now = new Date()
): AnnouncementReadState => {
  const normalizedLeft = normalizeReadState(left, now);
  const normalizedRight = normalizeReadState(right, now);
  const leftTime = toTime(normalizedLeft.readThroughAt) ?? 0;
  const rightTime = toTime(normalizedRight.readThroughAt) ?? 0;
  const through = Math.max(leftTime, rightTime);
  return {
    readThroughAt: through > 0 ? new Date(through).toISOString() : null,
    readTokens: sanitizeReadTokens([...normalizedLeft.readTokens, ...normalizedRight.readTokens])
  };
};

export const isAnnouncementExpired = (announcement: AnnouncementVisibility, now = new Date()) => {
  const expiresAt = toTime(announcement.expiresAt);
  return expiresAt !== null && expiresAt <= now.getTime();
};

export const isAnnouncementVisible = (
  announcement: AnnouncementVisibility,
  now = new Date(),
  includeExpired = true
) => {
  if (announcement.status !== 'published') return false;
  const publishedAt = toTime(announcement.publishedAt);
  if (publishedAt === null || publishedAt > now.getTime()) return false;
  return includeExpired || !isAnnouncementExpired(announcement, now);
};

export const isAnnouncementUnread = (
  announcement: AnnouncementVisibility,
  state: Partial<AnnouncementReadState> | null | undefined,
  now = new Date()
) => {
  if (!isAnnouncementVisible(announcement, now, false) || !announcement.publishedAt) return false;
  const publishedAt = toTime(announcement.publishedAt);
  if (publishedAt === null) return false;
  const normalized = normalizeReadState(state, now);
  const through = toTime(normalized.readThroughAt) ?? 0;
  if (publishedAt <= through) return false;
  return !normalized.readTokens.includes(
    announcementReadToken(announcement.id, announcement.publishedAt)
  );
};

export const markAnnouncementRead = (
  state: Partial<AnnouncementReadState> | null | undefined,
  announcement: AnnouncementVisibility,
  now = new Date()
): AnnouncementReadState => {
  const normalized = normalizeReadState(state, now);
  if (!announcement.publishedAt) return normalized;
  const token = announcementReadToken(announcement.id, announcement.publishedAt);
  if (normalized.readTokens.includes(token)) return normalized;
  return {
    ...normalized,
    readTokens: sanitizeReadTokens([...normalized.readTokens, token])
  };
};

export const markAllAnnouncementsRead = (
  state: Partial<AnnouncementReadState> | null | undefined,
  now = new Date()
): AnnouncementReadState => ({
  readThroughAt: now.toISOString(),
  readTokens: normalizeReadState(state, now).readTokens.filter((token) => {
    const publishedAt = Number(token.split('@')[1]);
    return Number.isFinite(publishedAt) && publishedAt > now.getTime();
  })
});
