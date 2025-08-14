<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import type { PageData } from './$types';
  import type { InviteLink } from '$lib/types';
  import { formatDateTime, getDisplayName, pageTitle } from '$lib/utils';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.search || '');
  let selectedStatus = $state(data.status || 'all');
  let searchTimeout: ReturnType<typeof setTimeout>;
  let copiedId = $state<string | null>(null);

  // Status filter options
  const statusOptions = [
    { value: 'all', label: m.admin_all_statuses() },
    { value: 'active', label: m.active() },
    { value: 'unused', label: m.unused() },
    { value: 'expired', label: m.expired() }
  ];

  const handleSearchInput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      updateFilters();
    }, 300);
  };

  const handleStatusChange = () => {
    updateFilters();
  };

  const updateFilters = () => {
    const url = new URL(page.url);

    if (searchQuery.trim()) {
      url.searchParams.set('search', searchQuery.trim());
    } else {
      url.searchParams.delete('search');
    }

    if (selectedStatus && selectedStatus !== 'all') {
      url.searchParams.set('status', selectedStatus.toString());
    } else {
      url.searchParams.delete('status');
    }

    url.searchParams.delete('page'); // Reset to first page
    goto(url.toString());
  };

  const copyInviteLink = (code: string) => {
    const link = `${window.location.origin}${base}/invite/${code}`;
    navigator.clipboard.writeText(link);
    copiedId = code;
    setTimeout(() => {
      if (copiedId === code) {
        copiedId = null; // Clear after a short delay
      }
    }, 2000);
  };

  const isExpired = (invite: InviteLink) => {
    return invite.expiresAt
      ? new Date(invite.expiresAt) < new Date()
      : invite.maxUses && invite.currentUses >= invite.maxUses;
  };

  const getStatusBadgeClass = (invite: InviteLink) => {
    if (isExpired(invite)) return 'badge-error';
    if (invite.currentUses > 0) return 'badge-success';
    return 'badge-info';
  };

  const getStatusText = (invite: InviteLink) => {
    if (isExpired(invite)) return m.expired();
    if (invite.currentUses > 0) return m.active();
    return m.new();
  };
</script>

<svelte:head>
  <title>{pageTitle(m.admin_invites(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <!-- Page Header -->
  <div class="flex flex-col items-center justify-between gap-4 md:flex-row">
    <div class="not-md:text-center">
      <h1 class="text-base-content text-3xl font-bold">{m.admin_invites()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_invite_description()}</p>
    </div>

    <!-- Invite Statistics -->
    <div class="flex gap-4 not-sm:flex-wrap">
      <div class="stat bg-base-100 min-w-0 rounded-lg shadow-sm">
        <div class="stat-title text-xs">{m.total()}</div>
        <div class="stat-value text-lg">{data.inviteStats?.total || 0}</div>
      </div>
      <div class="stat bg-base-100 min-w-0 rounded-lg shadow-sm">
        <div class="stat-title text-xs">{m.active()}</div>
        <div class="stat-value text-success text-lg">{data.inviteStats?.active || 0}</div>
      </div>
      <div class="stat bg-base-100 min-w-0 rounded-lg shadow-sm">
        <div class="stat-title text-xs">{m.unused()}</div>
        <div class="stat-value text-info text-lg">{data.inviteStats?.unused || 0}</div>
      </div>
      <div class="stat bg-base-100 min-w-0 rounded-lg shadow-sm">
        <div class="stat-title text-xs">{m.expired()}</div>
        <div class="stat-value text-error text-lg">{data.inviteStats?.expired || 0}</div>
      </div>
    </div>
  </div>

  <!-- Filters -->
  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <div class="flex gap-4">
      <div class="form-control flex-1">
        <label class="label" for="search">
          <span class="label-text font-medium">{m.search()}</span>
        </label>
        <input
          id="search"
          type="text"
          class="input input-bordered w-full"
          placeholder={m.admin_invite_search_placeholder()}
          bind:value={searchQuery}
          oninput={handleSearchInput}
        />
      </div>

      <div class="form-control">
        <label class="label" for="status">
          <span class="label-text font-medium">{m.admin_status()}</span>
        </label>
        <select
          id="status"
          class="select select-bordered w-full"
          bind:value={selectedStatus}
          onchange={handleStatusChange}
        >
          {#each statusOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>

  <!-- Invites List -->
  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if data.invites && data.invites.length > 0}
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th class="not-md:hidden">{m.admin_invite_code()}</th>
              <th>{m.admin_invite_target()}</th>
              <th class="not-sm:hidden">{m.admin_invite_creator()}</th>
              <th class="not-md:hidden">{m.admin_invite_usage()}</th>
              <th>{m.admin_status()}</th>
              <th>{m.admin_invite_created()}</th>
              <th class="text-right">{m.admin_actions()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.invites as invite (invite.id)}
              <tr class="hover">
                <td class="not-md:hidden">
                  <div class="font-mono text-sm">
                    <button
                      class="hover:text-accent cursor-pointer transition-colors"
                      onclick={() => copyInviteLink(invite.code)}
                      title={m.admin_invite_copy_link()}
                    >
                      {invite.code}
                    </button>
                  </div>
                </td>
                <td>
                  <div class="text-sm">
                    {#if invite.club}
                      <div class="flex items-center gap-2">
                        <span class="not-xl:hidden">
                          <i class="fa-solid fa-users text-primary"></i>
                        </span>
                        <a
                          href="{base}/clubs/{invite.club.id}"
                          target="_blank"
                          class="hover:text-accent line-clamp-2 font-medium transition-colors"
                        >
                          {invite.club.name}
                        </a>
                      </div>
                    {:else if invite.university}
                      <div class="flex items-center gap-2">
                        <span class="not-xl:hidden">
                          <i class="fa-solid fa-graduation-cap text-primary"></i>
                        </span>
                        <a
                          href="{base}/universities/{invite.university.id}"
                          target="_blank"
                          class="hover:text-accent line-clamp-2 font-medium transition-colors"
                        >
                          {invite.university.name}
                        </a>
                      </div>
                    {:else}
                      <span class="text-base-content/60">{m.admin_invite_unknown_target()}</span>
                    {/if}
                  </div>
                </td>
                <td class="max-w-[10vw] truncate not-sm:hidden">
                  <a
                    href="{base}/users/{invite.creator?.id}"
                    target="_blank"
                    class="hover:text-accent text-sm transition-colors"
                    title={getDisplayName(invite.creator)}
                  >
                    {getDisplayName(invite.creator)}
                  </a>
                </td>
                <td class="not-md:hidden">
                  <div class="text-sm">
                    {m.uses({
                      current: invite.currentUses || 0,
                      max: invite.maxUses || 0
                    })}
                  </div>
                </td>
                <td>
                  <div class="badge badge-soft text-nowrap {getStatusBadgeClass(invite)}">
                    {getStatusText(invite)}
                  </div>
                </td>
                <td>
                  <div class="text-sm">
                    {formatDateTime(invite.createdAt)}
                    {#if invite.expiresAt}
                      <div class="text-base-content/60 text-xs">
                        {m.expires()}: {formatDateTime(invite.expiresAt)}
                      </div>
                    {/if}
                  </div>
                </td>
                <td>
                  <div class="flex justify-end gap-2">
                    <button
                      class="btn btn-soft btn-sm text-nowrap"
                      onclick={() => copyInviteLink(invite.code)}
                      title={m.admin_invite_copy_link()}
                      disabled={copiedId === invite.code}
                    >
                      {#if copiedId === invite.code}
                        <i class="fa-solid fa-check"></i>
                        <span class="not-lg:hidden">{m.copied()}</span>
                      {:else}
                        <i class="fa-solid fa-copy"></i>
                        <span class="not-lg:hidden">{m.copy()}</span>
                      {/if}
                    </button>
                    <form method="POST" action="?/delete" use:enhance class="inline">
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <button
                        type="submit"
                        class="btn btn-error btn-sm btn-soft text-nowrap"
                        onclick={() => confirm(m.admin_invite_delete_confirm())}
                      >
                        <i class="fa-solid fa-trash"></i>
                        <span class="not-lg:hidden">{m.delete()}</span>
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      {#if data.hasMore}
        <div class="border-base-300 border-t p-4">
          <div class="flex justify-center gap-2">
            {#if (data.currentPage || 1) > 1}
              <a
                href="?page={(data.currentPage || 1) - 1}{data.search
                  ? `&search=${encodeURIComponent(data.search)}`
                  : ''}{data.status && data.status !== 'all' ? `&status=${data.status}` : ''}"
                class="btn btn-soft"
              >
                {m.previous_page()}
              </a>
            {/if}
            <span class="btn btn-disabled btn-soft">
              {m.page({ page: data.currentPage || 1 })}
            </span>
            <a
              href="?page={(data.currentPage || 1) + 1}{data.search
                ? `&search=${encodeURIComponent(data.search)}`
                : ''}{data.status && data.status !== 'all' ? `&status=${data.status}` : ''}"
              class="btn btn-soft"
            >
              {m.next_page()}
            </a>
          </div>
        </div>
      {/if}
    {:else}
      <div class="py-12 text-center">
        <i class="fa-solid fa-link text-base-content/40 mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">{m.admin_invite_no_invites()}</h3>
        <p class="text-base-content/60">
          {data.search ? m.admin_invite_no_results() : m.admin_invite_no_manage()}
        </p>
      </div>
    {/if}
  </div>
</div>
