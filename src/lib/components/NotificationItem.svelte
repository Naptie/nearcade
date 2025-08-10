<script lang="ts">
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { formatDistanceToNow } from 'date-fns';
  import { zhCN, enUS } from 'date-fns/locale';
  import { getLocale } from '$lib/paraglide/runtime';
  import UserAvatar from './UserAvatar.svelte';
  import { getDisplayName } from '$lib/utils';
  import type { Notification } from '$lib/notifications.server';

  interface Props {
    notification: Notification;
  }

  let { notification }: Props = $props();

  function getNotificationIcon(type: string): string {
    switch (type) {
      case 'COMMENTS':
        return 'fa-solid fa-comment text-primary';
      case 'REPLIES':
        return 'fa-solid fa-reply text-info';
      case 'POST_VOTES':
        return notification.voteType === 'upvote'
          ? 'fa-solid fa-thumbs-up text-success'
          : 'fa-solid fa-thumbs-down text-error';
      case 'COMMENT_VOTES':
        return notification.voteType === 'upvote'
          ? 'fa-solid fa-thumbs-up text-success'
          : 'fa-solid fa-thumbs-down text-error';
      default:
        return 'fa-solid fa-bell';
    }
  }

  function getNotificationText(): string {
    const actorName = getDisplayName({
      name: notification.actorName,
      displayName: notification.actorDisplayName
    });

    switch (notification.type) {
      case 'COMMENTS':
        return m.notification_user_commented({ userName: actorName });
      case 'REPLIES':
        return m.notification_user_replied({ userName: actorName });
      case 'POST_VOTES':
        return notification.voteType === 'upvote'
          ? m.notification_user_upvoted_post({ userName: actorName })
          : m.notification_user_downvoted_post({ userName: actorName });
      case 'COMMENT_VOTES':
        return notification.voteType === 'upvote'
          ? m.notification_user_upvoted_comment({ userName: actorName })
          : m.notification_user_downvoted_comment({ userName: actorName });
      default:
        return '';
    }
  }

  function getNotificationLink(): string {
    const baseUrl = base || '';

    switch (notification.type) {
      case 'COMMENTS':
      case 'REPLIES':
      case 'COMMENT_VOTES':
        if (notification.universityId) {
          return `${baseUrl}/universities/${notification.universityId}/posts/${notification.postId}?comment=${notification.commentId}`;
        } else if (notification.clubId) {
          return `${baseUrl}/clubs/${notification.clubId}/posts/${notification.postId}?comment=${notification.commentId}`;
        }
        return '#';

      case 'POST_VOTES':
        if (notification.universityId) {
          return `${baseUrl}/universities/${notification.universityId}/posts/${notification.postId}`;
        } else if (notification.clubId) {
          return `${baseUrl}/clubs/${notification.clubId}/posts/${notification.postId}`;
        }
        return '#';

      default:
        return '#';
    }
  }

  function getTargetTitle(): string {
    return notification.postTitle || '';
  }

  function getContextText(): string | null {
    if (notification.universityName) {
      return notification.universityName;
    } else if (notification.clubName) {
      return notification.clubName;
    }
    return null;
  }
</script>

<div
  class="bg-base-100 hover:bg-base-200/50 flex items-start gap-3 rounded-lg p-3 transition-colors"
>
  <!-- User Avatar -->
  <div class="flex-shrink-0">
    <UserAvatar
      user={{
        image: notification.actorImage,
        name: notification.actorName,
        displayName: notification.actorDisplayName
      }}
      size="sm"
    />
  </div>

  <!-- Notification Content -->
  <div class="min-w-0 flex-1">
    <div class="flex flex-col gap-1">
      <!-- Notification Description -->
      <div class="text-sm">
        <span class="text-base-content/80">{getNotificationText()}</span>
        <a
          href={getNotificationLink()}
          class="text-accent hover:text-accent/80 ml-1 font-medium transition-colors"
        >
          {getTargetTitle()}
        </a>
      </div>

      <!-- Context (University/Club) -->
      {#if getContextText()}
        <div class="text-base-content/60 text-xs">
          <i class="fa-solid fa-building mr-1"></i>
          {getContextText()}
        </div>
      {/if}

      <!-- Preview for Comments/Replies -->
      {#if (notification.type === 'COMMENTS' || notification.type === 'REPLIES') && notification.commentContent}
        <div class="text-base-content/60 truncate text-xs italic">
          "{notification.commentContent}{notification.commentContent.length >= 100 ? '...' : ''}"
        </div>
      {/if}
    </div>
  </div>

  <!-- Icon and Timestamp -->
  <div class="flex flex-col items-end gap-2">
    <div class="flex-shrink-0">
      <i class="{getNotificationIcon(notification.type)} text-base-content/60"></i>
    </div>
    <span class="text-base-content/50 text-xs">
      {formatDistanceToNow(new Date(notification.createdAt), {
        addSuffix: true,
        locale: getLocale() === 'en' ? enUS : zhCN
      })}
    </span>
  </div>
</div>
