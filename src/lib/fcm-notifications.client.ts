/**
 * Firebase Cloud Messaging client utilities
 */
import type { Notification } from '$lib/types';
import { getDisplayName } from '$lib/utils';

export interface FCMNotificationContent {
  title: string;
  body: string;
}

/**
 * Generate FCM notification content using simple text generation
 * This will be called server-side with proper localization
 */
export function generateFCMNotificationContent(notification: Notification): FCMNotificationContent {
  const actorDisplayName = getDisplayName({
    name: notification.actorName,
    displayName: notification.actorDisplayName
  });

  const targetName = 
    notification.postTitle ??
    (notification.joinRequestType === 'university'
      ? notification.universityName
      : notification.clubName) ??
    '';

  let title = 'nearcade';
  let body = '';

  switch (notification.type) {
    case 'COMMENTS':
      title = 'New Comment';
      body = `${actorDisplayName} commented on ${targetName}`;
      if (notification.content) {
        body += `: ${notification.content}`;
      }
      break;

    case 'REPLIES':
      title = 'New Reply';
      body = `${actorDisplayName} replied to your comment on ${targetName}`;
      if (notification.content) {
        body += `: ${notification.content}`;
      }
      break;

    case 'POST_VOTES':
      if (notification.voteType === 'upvote') {
        title = 'Post Upvoted';
        body = `${actorDisplayName} upvoted your post ${targetName}`;
      } else {
        title = 'Post Downvoted';
        body = `${actorDisplayName} downvoted your post ${targetName}`;
      }
      break;

    case 'COMMENT_VOTES':
      if (notification.voteType === 'upvote') {
        title = 'Comment Upvoted';
        body = `${actorDisplayName} upvoted your comment on ${targetName}`;
      } else {
        title = 'Comment Downvoted';
        body = `${actorDisplayName} downvoted your comment on ${targetName}`;
      }
      break;

    case 'JOIN_REQUESTS':
      if (notification.joinRequestStatus === 'approved') {
        title = 'Join Request Approved';
        body = `Your request to join ${targetName} was approved`;
      } else {
        title = 'Join Request Rejected';
        body = `Your request to join ${targetName} was rejected`;
      }
      if (notification.content) {
        body += `: ${notification.content}`;
      }
      break;

    default:
      title = 'nearcade';
      body = 'You have a new notification';
  }

  return { title, body };
}

/**
 * Generate notification data for navigation
 */
export function generateNotificationData(notification: Notification) {
  return {
    postId: notification.postId,
    commentId: notification.commentId,
    universityId: notification.universityId,
    clubId: notification.clubId
  };
}