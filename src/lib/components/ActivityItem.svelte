<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { formatDistanceToNow } from 'date-fns';
  import { zhCN, enUS } from 'date-fns/locale';
  import { getLocale } from '$lib/paraglide/runtime';
  import { formatChangelogDescription } from '$lib/utils/changelog';
  import type { Activity } from '$lib/types';
  import { strip } from '$lib/utils/markdown';
  import { onMount } from 'svelte';
  import { getDisplayName } from '$lib/utils';

  interface Props {
    activity: Activity;
  }

  let { activity }: Props = $props();

  let content = $state(activity.commentContent || '');

  let icon = $derived.by(() => {
    switch (activity.type) {
      case 'post':
        return 'fa-solid fa-pen-to-square text-info';
      case 'comment':
        return 'fa-solid fa-comment text-info';
      case 'reply':
        return 'fa-solid fa-reply text-info';
      case 'post_vote':
      case 'comment_vote':
        return activity.voteType === 'upvote'
          ? 'fa-solid fa-thumbs-up text-success'
          : 'fa-solid fa-thumbs-down text-error';
      case 'changelog':
        return 'fa-solid fa-list-ul text-warning';
      case 'university_join':
        return 'fa-solid fa-graduation-cap text-primary';
      case 'club_join':
        return 'fa-solid fa-user-plus text-success';
      case 'club_create':
        return 'fa-solid fa-users text-primary';
      case 'shop_attendance':
        return 'fa-solid fa-gamepad text-info';
      default:
        return 'fa-solid fa-clock';
    }
  });

  let text = $derived.by(() => {
    const authorName = `<a href="${resolve('/(main)/users/[id]', {
      id: `@${activity.targetAuthorName}`
    })}" class="hover:text-accent transition-colors">${getDisplayName({
      name: activity.targetAuthorName,
      displayName: activity.targetAuthorDisplayName
    })}</a>`;
    const targetName = `<a href="${link}" class="text-accent hover:text-accent/80 font-medium transition-colors">${
      target
    }</a>`;

    switch (activity.type) {
      case 'post':
        return m.activity_created_post({ targetName });
      case 'comment':
        return m.activity_commented_on({ targetName });
      case 'reply':
        return m.activity_replied_to({
          authorName,
          targetName
        });
      case 'post_vote':
        return activity.voteType === 'upvote'
          ? m.activity_upvoted_post({ targetName })
          : m.activity_downvoted_post({ targetName });
      case 'comment_vote':
        return activity.voteType === 'upvote'
          ? m.activity_upvoted_comment({
              authorName,
              targetName
            })
          : m.activity_downvoted_comment({
              authorName,
              targetName
            });
      case 'changelog':
        return m.activity_contributed_to({ targetName });
      case 'university_join':
        return m.activity_joined_university({ targetName });
      case 'club_join':
        return m.activity_joined_club({ targetName });
      case 'club_create':
        return m.activity_created_club({ targetName });
      case 'shop_attendance':
        return activity.isLive
          ? m.activity_currently_visiting_shop({ targetName })
          : m.activity_visited_shop({ targetName });
      default:
        return '';
    }
  });

  let link = $derived.by(() => {
    switch (activity.type) {
      case 'post':
        if (activity.universityId) {
          return resolve('/(main)/universities/[id]/posts/[postId]', {
            id: activity.universityId,
            postId: activity.postId || ''
          });
        } else if (activity.clubId) {
          return resolve('/(main)/clubs/[id]/posts/[postId]', {
            id: activity.clubId,
            postId: activity.postId || ''
          });
        }
        return '#';

      case 'comment':
      case 'reply':
        if (activity.universityId) {
          return (
            resolve('/(main)/universities/[id]/posts/[postId]', {
              id: activity.universityId,
              postId: activity.postId || ''
            }) + `?comment=${activity.commentId}`
          );
        } else if (activity.clubId) {
          return (
            resolve('/(main)/clubs/[id]/posts/[postId]', {
              id: activity.clubId,
              postId: activity.postId || ''
            }) + `?comment=${activity.commentId}`
          );
        }
        return '#';

      case 'post_vote':
        if (activity.universityId) {
          return resolve('/(main)/universities/[id]/posts/[postId]', {
            id: activity.universityId,
            postId: activity.postId || ''
          });
        } else if (activity.clubId) {
          return resolve('/(main)/clubs/[id]/posts/[postId]', {
            id: activity.clubId,
            postId: activity.postId || ''
          });
        }
        return '#';

      case 'comment_vote':
        if (activity.universityId) {
          return (
            resolve('/(main)/universities/[id]/posts/[postId]', {
              id: activity.universityId,
              postId: activity.postId || ''
            }) + `?comment=${activity.commentId}`
          );
        } else if (activity.clubId) {
          return (
            resolve('/(main)/clubs/[id]/posts/[postId]', {
              id: activity.clubId,
              postId: activity.postId || ''
            }) + `?comment=${activity.commentId}`
          );
        }
        return '#';

      case 'changelog':
        if (activity.universityId) {
          return (
            resolve('/(main)/universities/[id]', {
              id: activity.universityId
            }) + `?entry=${activity.id}#changelog`
          );
        }
        return '#';

      case 'university_join':
        if (activity.joinedUniversityId) {
          return resolve('/(main)/universities/[id]', {
            id: activity.joinedUniversityId
          });
        }
        return '#';

      case 'club_join':
      case 'club_create':
        if (activity.clubId || activity.createdClubId) {
          const clubId = activity.clubId || activity.createdClubId || '';
          return resolve('/(main)/clubs/[id]', {
            id: clubId
          });
        }
        return '#';

      case 'shop_attendance':
        if (activity.shopSource && activity.shopId) {
          return resolve('/(main)/shops/[source]/[id]', {
            source: activity.shopSource,
            id: activity.shopId.toString()
          });
        }
        return '#';

      default:
        return '#';
    }
  });

  let target = $derived.by(() => {
    switch (activity.type) {
      case 'post':
        return activity.postTitle || '';
      case 'comment':
      case 'reply':
        return activity.parentPostTitle || '';
      case 'post_vote':
      case 'comment_vote':
        return activity.targetTitle || '';
      case 'changelog':
        if (activity.changelogEntry) {
          return formatChangelogDescription(activity.changelogEntry, m);
        }
        return activity.changelogTargetName || '';
      case 'university_join':
        return activity.joinedUniversityName || '';
      case 'club_join':
        return activity.joinedClubName || '';
      case 'club_create':
        return activity.createdClubName || '';
      case 'shop_attendance':
        return activity.shopName || '';
      default:
        return '';
    }
  });

  let context = $derived.by(() => {
    if (activity.universityName) {
      return activity.universityName;
    } else if (activity.clubName) {
      return activity.clubName;
    }
    return null;
  });

  onMount(async () => {
    if ((activity.type === 'comment' || activity.type === 'reply') && content) {
      content = await strip(content);
    }
  });
</script>

<div
  class="bg-base-100 hover:bg-base-200/50 flex items-start gap-3 rounded-lg p-3 transition {activity.isLive
    ? 'ring-warning hover:ring-warning/50 bg-gradient-to-br from-orange-600/30 via-amber-600/30 to-yellow-500/30 ring-2 hover:from-orange-600/10 hover:via-amber-600/10 hover:to-yellow-500/10'
    : ''}"
>
  <!-- Activity Icon -->
  <div class="mt-1 flex-shrink-0">
    <i class="{icon} text-base-content/60" class:text-warning={activity.isLive}></i>
  </div>

  <!-- Activity Content -->
  <div class="min-w-0 flex-1">
    <div class="flex flex-col gap-1">
      <!-- Activity Description -->
      <div
        class="text-base-content/80 text-sm transition-colors"
        class:text-warning={activity.isLive}
      >
        {@html text}
      </div>

      <!-- Activity Preview for Comments and Replies -->
      {#if (activity.type === 'comment' || activity.type === 'reply') && content}
        <div class="text-base-content/60 truncate text-xs italic">
          "{content}"
        </div>
      {/if}

      <!-- Shop Attendance Details -->
      {#if activity.type === 'shop_attendance'}
        <div class="text-base-content/60 text-xs">
          {#if activity.attendanceGames}
            <div class="mb-1">
              <i class="fa-solid fa-gamepad mr-1"></i>
              {activity.attendanceGames}
            </div>
          {/if}
          {#if activity.duration && activity.duration > 0}
            <div>
              <i class="fa-solid fa-clock mr-1"></i>
              {m.activity_duration({
                duration: Math.round(activity.duration / (1000 * 60)) // Convert to minutes
              })}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Context (University/Club) -->
      {#if context}
        <a
          href={activity.universityId
            ? resolve('/(main)/universities/[id]', { id: activity.universityId })
            : resolve('/(main)/clubs/[id]', { id: activity.clubId || '' })}
          class="text-base-content/60 hover:text-accent flex w-fit items-center gap-1 text-xs transition-colors"
        >
          {#if activity.universityId}
            <i class="fa-solid fa-graduation-cap"></i>
          {:else}
            <i class="fa-solid fa-users"></i>
          {/if}
          {context}
        </a>
      {/if}
    </div>
  </div>

  <!-- Timestamp -->
  <div class="flex-shrink-0">
    <span class="text-base-content/50 text-xs">
      {formatDistanceToNow(new Date(activity.createdAt), {
        addSuffix: true,
        locale: getLocale() === 'en' ? enUS : zhCN
      })}
    </span>
  </div>
</div>
