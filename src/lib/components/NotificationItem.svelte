<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { resolve, base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { formatDistanceToNow } from 'date-fns';
  import { zhCN, enUS } from 'date-fns/locale';
  import { getLocale } from '$lib/paraglide/runtime';
  import UserAvatar from './UserAvatar.svelte';
  import { getDisplayName } from '$lib/utils';
  import type { Notification } from '$lib/types';
  import { onMount } from 'svelte';
  import { strip } from '$lib/utils/markdown';
  import { getNotificationLink } from '$lib/notifications/index.client';

  interface Props {
    notification: Notification;
  }

  let { notification }: Props = $props();

  let content = $state(notification.content || '');

  let context = $derived.by(() => {
    if (notification.universityName) {
      return notification.universityName;
    } else if (notification.clubName) {
      return notification.clubName;
    }
    return null;
  });

  let text = $derived.by(() => {
    const actorName = `<a href="${resolve('/(main)/users/[id]', { id: '@' + notification.actorName })}" class="hover:text-accent transition-colors">${getDisplayName(
      {
        name: notification.actorName,
        displayName: notification.actorDisplayName
      }
    )}</a>`;
    const targetName = `<a href="${link}" class="text-accent hover:text-accent/80 font-medium transition-colors">${
      notification.postTitle ??
      (notification.joinRequestType === 'university'
        ? notification.universityName
        : notification.clubName)
    }</a>`;

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
  });

  let link = $derived(getNotificationLink(notification, base));

  let icon = $derived.by(() => {
    switch (notification.type) {
      case 'COMMENTS':
        return 'fa-solid fa-comment text-info';
      case 'REPLIES':
        return 'fa-solid fa-reply text-info';
      case 'POST_VOTES':
      case 'COMMENT_VOTES':
        return notification.voteType === 'upvote'
          ? 'fa-solid fa-thumbs-up text-success'
          : 'fa-solid fa-thumbs-down text-error';
      case 'JOIN_REQUESTS':
        return notification.joinRequestStatus === 'approved'
          ? 'fa-solid fa-user-check text-success'
          : 'fa-solid fa-user-xmark text-error';
      default:
        return 'fa-solid fa-bell';
    }
  });

  onMount(async () => {
    if ((notification.type === 'COMMENTS' || notification.type === 'REPLIES') && content) {
      content = await strip(content);
    }
  });
</script>

<div
  class="bg-base-100 hover:bg-base-200/50 flex items-center gap-3 rounded-lg p-3 transition-colors"
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
      <div class="text-base-content/80 text-sm">
        {@html text}
      </div>

      <!-- Preview for Comments/Replies -->
      {#if (notification.type === 'COMMENTS' || notification.type === 'REPLIES') && content}
        <div class="text-base-content/60 truncate text-xs italic">
          "{content}"
        </div>
      {/if}

      <!-- Context (University/Club) -->
      {#if context}
        <a
          href={notification.universityId
            ? resolve('/(main)/universities/[id]', { id: notification.universityId })
            : resolve('/(main)/clubs/[id]', { id: notification.clubId || '' })}
          class="text-base-content/60 hover:text-accent flex w-fit items-center gap-1 text-xs transition-colors"
        >
          {#if notification.universityId}
            <i class="fa-solid fa-graduation-cap"></i>
          {:else}
            <i class="fa-solid fa-users"></i>
          {/if}
          {context}
        </a>
      {/if}
    </div>
  </div>

  <!-- Icon and Timestamp -->
  <div class="flex h-full flex-col items-end gap-1">
    <div class="flex-shrink-0">
      <i class="{icon} text-base-content/60"></i>
    </div>
    <span class="text-base-content/50 text-xs">
      {formatDistanceToNow(new Date(notification.createdAt), {
        addSuffix: true,
        locale: getLocale() === 'en' ? enUS : zhCN
      })}
    </span>
  </div>
</div>
