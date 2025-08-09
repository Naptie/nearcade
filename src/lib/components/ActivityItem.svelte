<script lang="ts">
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { formatDistanceToNow } from 'date-fns';
  import { zhCN, enUS } from 'date-fns/locale';
  import { getLocale } from '$lib/paraglide/runtime';
  import type { Activity } from '$lib/types';

  interface Props {
    activity: Activity;
  }

  let { activity }: Props = $props();

  function getActivityIcon(type: string): string {
    switch (type) {
      case 'post':
        return 'fa-solid fa-pen-to-square';
      case 'comment':
        return 'fa-solid fa-comment';
      case 'post_vote':
        return activity.voteType === 'upvote' ? 'fa-solid fa-thumbs-up' : 'fa-solid fa-thumbs-down';
      case 'comment_vote':
        return activity.voteType === 'upvote' ? 'fa-solid fa-thumbs-up' : 'fa-solid fa-thumbs-down';
      case 'changelog':
        return 'fa-solid fa-list-ul';
      default:
        return 'fa-solid fa-clock';
    }
  }

  function getActivityText(): string {
    switch (activity.type) {
      case 'post':
        return m.activity_created_post();
      case 'comment':
        return m.activity_commented_on();
      case 'post_vote':
        return activity.voteType === 'upvote' ? m.activity_upvoted_post() : m.activity_downvoted_post();
      case 'comment_vote':
        return activity.voteType === 'upvote'
          ? m.activity_upvoted_comment({ authorName: activity.targetAuthorName || m.anonymous_user() })
          : m.activity_downvoted_comment({ authorName: activity.targetAuthorName || m.anonymous_user() });
      case 'changelog':
        return m.activity_contributed_to();
      default:
        return '';
    }
  }

  function getActivityLink(): string {
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
          return `${baseUrl}/universities/${activity.universityId}#changelog`;
        } else if (activity.clubId) {
          return `${baseUrl}/clubs/${activity.clubId}#changelog`;
        }
        return '#';
      
      default:
        return '#';
    }
  }

  function getTargetTitle(): string {
    switch (activity.type) {
      case 'post':
        return activity.postTitle || '';
      case 'comment':
        return activity.parentPostTitle || '';
      case 'post_vote':
      case 'comment_vote':
        return activity.targetTitle || '';
      case 'changelog':
        return activity.changelogTargetName || '';
      default:
        return '';
    }
  }

  function getContextText(): string | null {
    if (activity.universityName) {
      return activity.universityName;
    } else if (activity.clubName) {
      return activity.clubName;
    }
    return null;
  }
</script>

<div class="flex items-start gap-3 p-3 rounded-lg bg-base-100 hover:bg-base-200/50 transition-colors">
  <!-- Activity Icon -->
  <div class="flex-shrink-0 mt-1">
    <i class="{getActivityIcon(activity.type)} text-base-content/60"></i>
  </div>

  <!-- Activity Content -->
  <div class="flex-1 min-w-0">
    <div class="flex flex-col gap-1">
      <!-- Activity Description -->
      <div class="text-sm">
        <span class="text-base-content/80">{getActivityText()}</span>
        <a 
          href={getActivityLink()} 
          class="font-medium text-accent hover:text-accent/80 transition-colors ml-1"
        >
          {getTargetTitle()}
        </a>
      </div>

      <!-- Context (University/Club) -->
      {#if getContextText()}
        <div class="text-xs text-base-content/60">
          <i class="fa-solid fa-building mr-1"></i>
          {getContextText()}
        </div>
      {/if}

      <!-- Activity Preview for Comments -->
      {#if activity.type === 'comment' && activity.commentContent}
        <div class="text-xs text-base-content/60 italic truncate">
          "{activity.commentContent}{activity.commentContent.length >= 100 ? '...' : ''}"
        </div>
      {/if}
    </div>
  </div>

  <!-- Timestamp -->
  <div class="flex-shrink-0">
    <span class="text-xs text-base-content/50">
      {formatDistanceToNow(new Date(activity.createdAt), {
        addSuffix: true,
        locale: getLocale() === 'en' ? enUS : zhCN
      })}
    </span>
  </div>
</div>