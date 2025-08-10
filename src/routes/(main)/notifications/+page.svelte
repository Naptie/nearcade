<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import NotificationItem from '$lib/components/NotificationItem.svelte';
  import type { Notification } from '$lib/notifications.server';

  // Notification loading state
  let notifications = $state<Notification[]>([]);
  let isLoadingNotifications = $state(true);
  let isLoadingMore = $state(false);
  let hasMore = $state(true);
  let notificationsPage = $state(1);
  let notificationsError = $state<string | null>(null);
  let unreadOnly = $state(true);

  const loadNotifications = async (page = 1, append = false) => {
    const isInitialLoad = page === 1;
    if (isInitialLoad) {
      isLoadingNotifications = true;
      notificationsError = null;
    } else {
      isLoadingMore = true;
    }

    try {
      const unreadParam = unreadOnly ? '&unreadOnly=true' : '';
      const response = await fetch(`${base}/api/notifications?page=${page}&limit=20${unreadParam}`);

      if (!response.ok) {
        throw new Error('Failed to load notifications');
      }

      const result = (await response.json()) as {
        notifications: Notification[];
        hasMore: boolean;
        page: number;
        limit: number;
      };

      if (append) {
        notifications = [...notifications, ...result.notifications];
      } else {
        notifications = result.notifications;
      }

      hasMore = result.hasMore;
      notificationsPage = page;
    } catch (err) {
      console.error('Error loading notifications:', err);
      notificationsError = err instanceof Error ? err.message : 'Failed to load notifications';
    } finally {
      isLoadingNotifications = false;
      isLoadingMore = false;
    }
  };

  const loadMoreNotifications = async () => {
    if (!hasMore || isLoadingMore) return;
    await loadNotifications(notificationsPage + 1, true);
  };

  const markAsRead = async () => {
    try {
      const response = await fetch(`${base}/api/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: 'markAsRead' })
      });

      if (!response.ok) {
        throw new Error('Failed to mark notifications as read');
      }

      // Reload notifications
      loadNotifications();
    } catch (err) {
      console.error('Error marking notifications as read:', err);
    }
  };

  // Watch unreadOnly changes
  $effect(() => {
    loadNotifications();
  });

  onMount(() => {
    loadNotifications();
  });
</script>

<svelte:head>
  <title>{m.notifications()} - {m.app_name()}</title>
</svelte:head>

<div class="pt-12">
  <div class="mx-auto max-w-7xl min-w-3xs px-4 py-8 sm:px-6 lg:px-8">
    <div class="space-y-6">
      <!-- Header -->
      <div>
        <h1 class="text-2xl font-bold">{m.notifications()}</h1>
      </div>

      <!-- Controls -->
      <div class="bg-base-200 rounded-xl p-6">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-4">
            <label class="label cursor-pointer gap-2">
              <input type="checkbox" class="toggle toggle-primary" bind:checked={unreadOnly} />
              <span class="label-text">{m.show_unread_only()}</span>
            </label>
          </div>

          <button class="btn btn-primary btn-soft btn-sm" onclick={markAsRead}>
            <i class="fa-solid fa-check"></i>
            {m.mark_all_as_read()}
          </button>
        </div>
      </div>

      <!-- Notifications List -->
      <div class="bg-base-200 rounded-xl p-6">
        <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
          <i class="fa-solid fa-bell"></i>
          {unreadOnly ? m.unread_notifications() : m.all_notifications()}
        </h3>

        {#if isLoadingNotifications}
          <div class="text-base-content/60 py-8 text-center">
            <span class="loading loading-spinner loading-lg"></span>
            <p class="mt-2">{m.loading()}</p>
          </div>
        {:else if notificationsError}
          <div class="text-base-content/60 py-8 text-center">
            <i class="fa-solid fa-exclamation-triangle text-error mb-2 text-3xl"></i>
            <p>{notificationsError}</p>
            <button class="btn btn-sm btn-soft mt-4" onclick={() => loadNotifications()}>
              <i class="fa-solid fa-rotate"></i>
              {m.try_again()}
            </button>
          </div>
        {:else if notifications.length > 0}
          <div class="space-y-2">
            {#each notifications as notification (notification.id)}
              <NotificationItem {notification} />
            {/each}
          </div>

          <!-- Load More Button -->
          {#if hasMore}
            <div class="mt-6 text-center">
              <button
                class="btn btn-soft btn-sm"
                onclick={loadMoreNotifications}
                disabled={isLoadingMore}
              >
                {#if isLoadingMore}
                  <span class="loading loading-spinner loading-sm"></span>
                {/if}
                {m.load_more()}
              </button>
            </div>
          {/if}
        {:else}
          <div class="text-base-content/60 py-8 text-center">
            <i class="fa-solid fa-bell-slash mb-2 text-3xl"></i>
            <p>
              {unreadOnly ? m.no_unread_notifications() : m.no_notifications()}
            </p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
