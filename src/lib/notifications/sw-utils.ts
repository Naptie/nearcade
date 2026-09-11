import { m } from '$lib/paraglide/messages';
import type { Notification } from '$lib/types';
import { ugcRemovalNoun, ugcReasonLabel } from '$lib/ugc/labels';

const getDisplayName = (user?: { displayName?: string | null; name?: string | null }) => {
  return !user ? 'Unknown User' : user.displayName || (user.name ? `@${user.name}` : 'Anonymous');
};

export const getNotificationTargetName = (notification: Notification) => {
  if (notification.shopDeleteRequestId) {
    return notification.shopName ?? '';
  }

  if (notification.shopId) {
    return notification.shopName ?? '';
  }

  if (notification.postTitle) {
    return notification.postTitle;
  }

  if (notification.joinRequestType === 'university') {
    return notification.universityName ?? '';
  }

  return notification.clubName ?? '';
};

export const getNotificationTitle = (notification: Notification) => {
  const actorName = getDisplayName({
    name: notification.actorName,
    displayName: notification.actorDisplayName
  });
  const targetName = getNotificationTargetName(notification);

  switch (notification.type) {
    case 'COMMENTS':
      return `${actorName} commented on ${targetName}`;
    case 'REPLIES':
      return `${actorName} replied to ${targetName}`;
    case 'POST_VOTES':
      return notification.voteType === 'upvote'
        ? `${actorName} upvoted ${targetName}`
        : `${actorName} downvoted ${targetName}`;
    case 'COMMENT_VOTES':
      return notification.voteType === 'upvote'
        ? `${actorName} upvoted a comment on ${targetName}`
        : `${actorName} downvoted a comment on ${targetName}`;
    case 'JOIN_REQUESTS':
      return notification.joinRequestStatus === 'approved'
        ? `${actorName} approved your join request for ${targetName}`
        : `${actorName} rejected your join request for ${targetName}`;
    case 'SHOP_DELETE_REQUESTS':
      if (notification.shopDeleteRequestStatus === 'approved') {
        return `Delete request approved for ${targetName}`;
      }
      if (notification.shopDeleteRequestStatus === 'deleted') {
        return `Delete request deleted for ${targetName}`;
      }
      return `Delete request rejected for ${targetName}`;
    case 'SYSTEM': {
      const noun = ugcRemovalNoun(notification.contentType, notification.kind);
      if (notification.reviewedBy) {
        if (notification.reason) {
          return m.notification_system_content_removed_manual({
            type: noun,
            reason: ugcReasonLabel(notification.reason)
          });
        }
        return m.notification_system_content_removed_manual_noreason({ type: noun });
      }
      if (notification.reason) {
        return m.notification_system_content_removed({
          type: noun,
          reason: ugcReasonLabel(notification.reason)
        });
      }
      return m.notification_system_content_removed_noreason({ type: noun });
    }
    default:
      return 'nearcade';
  }
};

export const getNotificationLink = (notification: Notification, base = '', fallback = '#') => {
  switch (notification.type) {
    case 'COMMENTS':
    case 'REPLIES':
    case 'COMMENT_VOTES':
      if (notification.shopDeleteRequestId) {
        return `${base}/shops/delete-requests/${notification.shopDeleteRequestId}?comment=${notification.commentId}`;
      } else if (notification.shopId) {
        return `${base}/shops/${notification.shopId}?comment=${notification.commentId}`;
      } else if (notification.universityId) {
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

    case 'SHOP_DELETE_REQUESTS':
      if (notification.shopDeleteRequestStatus === 'deleted' && notification.shopId) {
        return `${base}/shops/${notification.shopId}`;
      }
      if (notification.shopDeleteRequestId) {
        return `${base}/shops/delete-requests/${notification.shopDeleteRequestId}`;
      }
      return fallback;

    case 'SYSTEM':
      if (notification.kind === 'shop' && notification.shopId) {
        return `${base}/shops/${notification.shopId}`;
      }
      if (notification.kind === 'delete_request' && notification.shopDeleteRequestId) {
        return `${base}/shops/delete-requests/${notification.shopDeleteRequestId}`;
      }
      if (notification.kind === 'comment' && notification.commentId) {
        if (notification.shopDeleteRequestId) {
          return `${base}/shops/delete-requests/${notification.shopDeleteRequestId}?comment=${notification.commentId}`;
        }
        if (notification.shopId) {
          return `${base}/shops/${notification.shopId}?comment=${notification.commentId}`;
        }
      }
      if (notification.kind === 'post' && notification.postId) {
        if (notification.universityId) {
          return `${base}/universities/${notification.universityId}/posts/${notification.postId}`;
        }
        if (notification.clubId) {
          return `${base}/clubs/${notification.clubId}/posts/${notification.postId}`;
        }
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
