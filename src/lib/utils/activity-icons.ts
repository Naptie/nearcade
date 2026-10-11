/**
 * Font Awesome glyph + semantic color per profile-feed activity type
 * (client-safe single source of truth). Used by `ActivityItem` and the
 * activity heatmap type filter; keep in sync with `activityTypeSchema`.
 */
import type { Activity } from '$lib/types';
import type { ActivityType } from '$lib/schemas/users';

export interface ActivityIcon {
  glyph: string;
  color: string;
}

export const ACTIVITY_TYPE_ICONS: Record<ActivityType, ActivityIcon> = {
  post: { glyph: 'fa-solid fa-pen-to-square', color: 'text-info' },
  comment: { glyph: 'fa-solid fa-comment', color: 'text-info' },
  reply: { glyph: 'fa-solid fa-reply', color: 'text-info' },
  shop_comment: { glyph: 'fa-solid fa-store', color: 'text-info' },
  shop_reply: { glyph: 'fa-solid fa-reply', color: 'text-info' },
  post_vote: { glyph: 'fa-solid fa-thumbs-up', color: 'text-success' },
  comment_vote: { glyph: 'fa-solid fa-thumbs-up', color: 'text-success' },
  shop_comment_vote: { glyph: 'fa-solid fa-thumbs-up', color: 'text-success' },
  shop_delete_request_comment_vote: { glyph: 'fa-solid fa-thumbs-up', color: 'text-success' },
  shop_delete_request_comment: { glyph: 'fa-solid fa-comment', color: 'text-warning' },
  shop_delete_request_reply: { glyph: 'fa-solid fa-reply', color: 'text-warning' },
  shop_delete_request_vote: { glyph: 'fa-solid fa-thumbs-up', color: 'text-success' },
  changelog: { glyph: 'fa-solid fa-list-ul', color: 'text-warning' },
  shop_changelog: { glyph: 'fa-solid fa-gamepad', color: 'text-warning' },
  university_join: { glyph: 'fa-solid fa-graduation-cap', color: 'text-primary' },
  club_join: { glyph: 'fa-solid fa-user-plus', color: 'text-success' },
  club_create: { glyph: 'fa-solid fa-users', color: 'text-primary' },
  attendance_report: { glyph: 'fa-solid fa-user-clock', color: 'text-info' },
  shop_attendance: { glyph: 'fa-solid fa-gamepad', color: 'text-info' }
};

/** Explicit grey fallback for unknown/legacy types. */
export const ACTIVITY_ICON_FALLBACK: ActivityIcon = {
  glyph: 'fa-solid fa-clock',
  color: 'text-base-content/60'
};

const UPVOTE_ICON: ActivityIcon = { glyph: 'fa-solid fa-thumbs-up', color: 'text-success' };
const DOWNVOTE_ICON: ActivityIcon = { glyph: 'fa-solid fa-thumbs-down', color: 'text-error' };

/** Variant-aware icon: votes flip glyph+color with the vote direction. */
export const getActivityIcon = (
  activity: Pick<Activity, 'type' | 'voteType' | 'shopDeleteRequestVoteType'>
): ActivityIcon => {
  switch (activity.type) {
    case 'post_vote':
    case 'comment_vote':
    case 'shop_comment_vote':
    case 'shop_delete_request_comment_vote':
      return activity.voteType === 'downvote' ? DOWNVOTE_ICON : UPVOTE_ICON;
    case 'shop_delete_request_vote':
      return activity.shopDeleteRequestVoteType === 'against' ? DOWNVOTE_ICON : UPVOTE_ICON;
    default:
      return ACTIVITY_TYPE_ICONS[activity.type] ?? ACTIVITY_ICON_FALLBACK;
  }
};
