import { PostReadability, type AnnouncementWithAuthor, type PostWithAuthor } from '$lib/types';

export type AnnouncementPostView = PostWithAuthor & {
  status: 'draft' | 'published';
  publishedAt: Date | null;
  expiresAt: Date | null;
};

export const toAnnouncementPostView = (
  announcement: AnnouncementWithAuthor
): AnnouncementPostView =>
  ({
    ...announcement,
    upvotes: 0,
    downvotes: 0,
    commentCount: 0,
    isLocked: false,
    readability: PostReadability.PUBLIC
  }) as AnnouncementPostView;
