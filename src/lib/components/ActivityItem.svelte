<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { formatDistanceToNow } from 'date-fns';
  import { zhCN, enUS } from 'date-fns/locale';
  import { getLocale } from '$lib/paraglide/runtime';
  import { formatChangelogDescription } from '$lib/changelog';
  import type { Activity } from '$lib/types';
  import { strip } from '$lib/markdown';
  import { onMount } from 'svelte';

  interface Props {
    activity: Activity;
  }

  let { activity }: Props = $props();

  let content = $state(activity.commentContent || '');

  let icon = $derived.by(() => {
    switch (activity.type) {
      case 'post':
        return 'fa-solid fa-pen-to-square';
      case 'comment':
        return 'fa-solid fa-comment';
      case 'reply':
        return 'fa-solid fa-reply';
      case 'post_vote':
      case 'comment_vote':
        return activity.voteType === 'upvote'
          ? 'fa-solid fa-thumbs-up text-success'
          : 'fa-solid fa-thumbs-down text-error';
      case 'changelog':
        return 'fa-solid fa-list-ul text-info';
      default:
        return 'fa-solid fa-clock';
    }
  });

  let text = $derived.by(() => {
    const authorName = `<a href="${base}/users/@${activity.targetAuthorName}" class="hover:text-accent transition-colors">${activity.targetAuthorDisplayName}</a>`;
    switch (activity.type) {
      case 'post':
        return m.activity_created_post();
      case 'comment':
        return m.activity_commented_on();
      case 'reply':
        return m.activity_replied_to({
          authorName
        });
      case 'post_vote':
        return activity.voteType === 'upvote'
          ? m.activity_upvoted_post()
          : m.activity_downvoted_post();
      case 'comment_vote':
        return activity.voteType === 'upvote'
          ? m.activity_upvoted_comment({
              authorName
            })
          : m.activity_downvoted_comment({
              authorName
            });
      case 'changelog':
        return m.activity_contributed_to();
      default:
        return '';
    }
  });

  let link = $derived.by(() => {
    const baseUrl = base || '';

    switch (activity.type) {
      case 'post':
        if (activity.universityId) {
          return `${baseUrl}/universities/${activity.universityId}/posts/${activity.postId}`;
        } else if (activity.clubId) {
          return `${baseUrl}/clubs/${activity.clubId}/posts/${activity.postId}`;
        }
        return '#';

      case 'comment':
      case 'reply':
        if (activity.universityId) {
          return `${baseUrl}/universities/${activity.universityId}/posts/${activity.postId}?comment=${activity.commentId}`;
        } else if (activity.clubId) {
          return `${baseUrl}/clubs/${activity.clubId}/posts/${activity.postId}?comment=${activity.commentId}`;
        }
        return '#';

      case 'post_vote':
        if (activity.universityId) {
          return `${baseUrl}/universities/${activity.universityId}/posts/${activity.postId}`;
        } else if (activity.clubId) {
          return `${baseUrl}/clubs/${activity.clubId}/posts/${activity.postId}`;
        }
        return '#';

      case 'comment_vote':
        if (activity.universityId) {
          return `${baseUrl}/universities/${activity.universityId}/posts/${activity.postId}?comment=${activity.commentId}`;
        } else if (activity.clubId) {
          return `${baseUrl}/clubs/${activity.clubId}/posts/${activity.postId}?comment=${activity.commentId}`;
        }
        return '#';

      case 'changelog':
        if (activity.universityId) {
          return `${baseUrl}/universities/${activity.universityId}?entry=${activity.id}#changelog`;
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
  class="bg-base-100 hover:bg-base-200/50 flex items-start gap-3 rounded-lg p-3 transition-colors"
>
  <!-- Activity Icon -->
  <div class="mt-1 flex-shrink-0">
    <i class="{icon} text-base-content/60"></i>
  </div>

  <!-- Activity Content -->
  <div class="min-w-0 flex-1">
    <div class="flex flex-col gap-1">
      <!-- Activity Description -->
      <div class="text-sm">
        <span class="text-base-content/80">{@html text}</span>
        <a href={link} class="text-accent hover:text-accent/80 font-medium transition-colors">
          {target}
        </a>
      </div>

      <!-- Activity Preview for Comments and Replies -->
      {#if (activity.type === 'comment' || activity.type === 'reply') && content}
        <div class="text-base-content/60 truncate text-xs italic">
          "{content}"
        </div>
      {/if}

      <!-- Context (University/Club) -->
      {#if context}
        <div class="text-base-content/60 text-xs">
          {#if activity.universityId}
            <i class="fa-solid fa-graduation-cap"></i>
          {:else}
            <i class="fa-solid fa-users"></i>
          {/if}
          {context}
        </div>
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
