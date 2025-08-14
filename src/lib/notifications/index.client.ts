import { m } from '$lib/paraglide/messages';
import type { Notification } from '$lib/types';

const getDisplayName = (user?: { displayName?: string | null; name?: string | null }) => {
  return !user
    ? m.unknown_user()
    : user.displayName || (user.name ? `@${user.name}` : m.anonymous_user());
};

export const getNotificationTitle = (notification: Notification) => {
  const actorName = getDisplayName({
    name: notification.actorName,
    displayName: notification.actorDisplayName
  });
  const targetName =
    notification.postTitle ??
    ((notification.joinRequestType === 'university'
      ? notification.universityName
      : notification.clubName) ||
      '');

  switch (notification.type) {
    case 'COMMENTS':
      return m.notification_user_commented({ userName: actorName, targetName });
    case 'REPLIES':
      return m.notification_user_replied({ userName: actorName, targetName });
    case 'POST_VOTES':
      return notification.voteType === 'upvote'
        ? m.notification_user_upvoted_post({ userName: actorName, targetName })
        : m.notification_user_downvoted_post({ userName: actorName, targetName });
    case 'COMMENT_VOTES':
      return notification.voteType === 'upvote'
        ? m.notification_user_upvoted_comment({ userName: actorName, targetName })
        : m.notification_user_downvoted_comment({ userName: actorName, targetName });
    case 'JOIN_REQUESTS':
      return notification.joinRequestStatus === 'approved'
        ? m.notification_user_approved_join_request({ userName: actorName, targetName })
        : m.notification_user_rejected_join_request({ userName: actorName, targetName });
    default:
      return '';
  }
};

export const getNotificationLink = (notification: Notification, base = '', fallback = '#') => {
  switch (notification.type) {
    case 'COMMENTS':
    case 'REPLIES':
    case 'COMMENT_VOTES':
      if (notification.universityId) {
        return `${base}/universities/${notification.universityId}/posts/${notification.postId}?comment=${notification.commentId}`;
      } else if (notification.clubId) {
        return `${base}/clubs/${notification.clubId}/posts/${notification.postId}?comment=${notification.commentId}`;
      }
      return fallback;

    case 'POST_VOTES':
      if (notification.universityId) {
        return `${base}/universities/${notification.universityId}/posts/${notification.postId}`;
      } else if (notification.clubId) {
        return `${base}/clubs/${notification.clubId}/posts/${notification.postId}`;
      }
      return fallback;

    default:
      if (notification.universityId) {
        return `${base}/universities/${notification.universityId}`;
      } else if (notification.clubId) {
        return `${base}/clubs/${notification.clubId}`;
      }
      return fallback;
  }
};
