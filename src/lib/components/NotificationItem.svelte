<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { resolve, base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { formatDistanceToNow } from 'date-fns';
  import { getLocale } from '$lib/paraglide/runtime';
  import UserAvatar from './UserAvatar.svelte';
  import { getDisplayName, getFnsLocale } from '$lib/utils';
  import type { Notification } from '$lib/types';
  import { onMount } from 'svelte';
  import { strip } from '$lib/utils/markdown';
  import { getNotificationLink, getNotificationTargetName } from '$lib/notifications/index.client';
  import { ugcRemovalNoun, ugcReasonLabel } from '$lib/ugc/labels';

  interface Props {
    notification: Notification;
  }

  let { notification }: Props = $props();

  let content = $derived(notification.content || '');

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
    const targetName = `<a href="${link}" class="text-accent hover:text-accent/80 font-medium transition-colors">${getNotificationTargetName(notification)}</a>`;

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
      case 'SHOP_DELETE_REQUESTS':
        if (notification.shopDeleteRequestStatus === 'approved') {
          return m.notification_delete_request_approved({
            userName: actorName,
            targetName
          });
        }
        if (notification.shopDeleteRequestStatus === 'deleted') {
          return m.notification_delete_request_deleted({
            userName: actorName,
            targetName
          });
        }
        return m.notification_delete_request_rejected({
          userName: actorName,
          targetName
        });
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
        return '';
    }
  });

  let link = $derived(getNotificationLink(notification, base));

  let { glyph, color } = $derived.by(() => {
    switch (notification.type) {
      case 'COMMENTS':
        return { glyph: 'fa-solid fa-comment', color: 'text-info' };
      case 'REPLIES':
        return { glyph: 'fa-solid fa-reply', color: 'text-info' };
      case 'POST_VOTES':
      case 'COMMENT_VOTES':
        return notification.voteType === 'upvote'
          ? { glyph: 'fa-solid fa-thumbs-up', color: 'text-success' }
          : { glyph: 'fa-solid fa-thumbs-down', color: 'text-error' };
      case 'JOIN_REQUESTS':
        return notification.joinRequestStatus === 'approved'
          ? { glyph: 'fa-solid fa-user-check', color: 'text-success' }
          : { glyph: 'fa-solid fa-user-xmark', color: 'text-error' };
      case 'SHOP_DELETE_REQUESTS':
        if (notification.shopDeleteRequestStatus === 'approved') {
          return { glyph: 'fa-solid fa-trash-can', color: 'text-success' };
        }
        if (notification.shopDeleteRequestStatus === 'deleted') {
          return { glyph: 'fa-solid fa-trash-can', color: 'text-warning' };
        }
        return { glyph: 'fa-solid fa-trash-can', color: 'text-error' };
      case 'SYSTEM':
        return { glyph: 'fa-solid fa-shield-halved', color: 'text-error' };
      default:
        return { glyph: 'fa-solid fa-bell', color: 'text-base-content/60' };
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
  <div class="shrink-0">
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

      <!-- Secondary line: quoted source for Comments/Replies/Delete Requests,
           masked removed text for SYSTEM removal notices -->
      {#if (notification.type === 'COMMENTS' || notification.type === 'REPLIES' || notification.type === 'SHOP_DELETE_REQUESTS' || notification.type === 'SYSTEM') && content}
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
    <div class="shrink-0">
      <i class="{glyph} {color}" aria-hidden="true"></i>
    </div>
    <span class="text-base-content/50 text-xs">
      {formatDistanceToNow(notification.createdAt, {
        addSuffix: true,
        locale: getFnsLocale(getLocale())
      })}
    </span>
  </div>
</div>
