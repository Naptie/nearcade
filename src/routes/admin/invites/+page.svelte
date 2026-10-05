<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { resolve, base } from '$app/paths';
  import type { PageData } from './$types';
  import type { InviteLink } from '$lib/types';
  import { adaptiveNewTab, formatDateTime, getDisplayName } from '$lib/utils';
  import AdminPage from '$lib/components/admin/AdminPage.svelte';
  import AdminStats from '$lib/components/admin/AdminStats.svelte';
  import AdminToolbar from '$lib/components/admin/AdminToolbar.svelte';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import AdminTable from '$lib/components/admin/AdminTable.svelte';
  import AdminPagination from '$lib/components/admin/AdminPagination.svelte';
  import AdminEmptyState from '$lib/components/admin/AdminEmptyState.svelte';
  import AdminRowActions from '$lib/components/admin/AdminRowActions.svelte';

  let { data }: { data: PageData } = $props();

  let copiedId = $state<string | null>(null);

  const stats = $derived([
    { label: m.total(), value: data.inviteStats?.total || 0 },
    { label: m.active(), value: data.inviteStats?.active || 0, class: 'text-success' },
    { label: m.unused(), value: data.inviteStats?.unused || 0, class: 'text-info' },
    { label: m.expired(), value: data.inviteStats?.expired || 0, class: 'text-error' }
  ]);

  // `''` means "no filter", so the status param is dropped from the URL.
  const statusOptions = [
    { value: '', label: m.admin_all_statuses() },
    { value: 'active', label: m.active() },
    { value: 'unused', label: m.unused() },
    { value: 'expired', label: m.expired() }
  ];

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

<AdminPage title={m.admin_invites()} description={m.admin_invite_description()}>
  {#snippet actions()}
    <AdminStats {stats} />
  {/snippet}

  <AdminToolbar
    placeholder={m.admin_invite_search_placeholder()}
    filters={[{ name: 'status', label: m.admin_status(), options: statusOptions }]}
  />

  <AdminPanel>
    {#if data.invites && data.invites.length > 0}
      <AdminTable>
        {#snippet head()}
          <tr>
            <th class="not-md:hidden">{m.admin_invite_code()}</th>
            <th>{m.admin_invite_target()}</th>
            <th class="not-sm:hidden">{m.admin_invite_creator()}</th>
            <th class="not-md:hidden">{m.admin_invite_usage()}</th>
            <th>{m.admin_status()}</th>
            <th>{m.admin_invite_created()}</th>
            <th class="text-right">{m.admin_actions()}</th>
          </tr>
        {/snippet}

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
                      href={resolve('/(main)/clubs/[id]', { id: invite.club.id })}
                      target={adaptiveNewTab()}
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
                      href={resolve('/(main)/universities/[id]', { id: invite.university.id })}
                      target={adaptiveNewTab()}
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
                href={resolve('/(main)/users/[id]', { id: invite.creator?.id || '' })}
                target={adaptiveNewTab()}
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
              <AdminRowActions>
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
                    type="button"
                    class="btn btn-error btn-sm btn-soft text-nowrap"
                    onclick={(e) =>
                      confirm(m.admin_invite_delete_confirm()) &&
                      e.currentTarget.closest('form')?.requestSubmit()}
                  >
                    <i class="fa-solid fa-trash"></i>
                    <span class="not-lg:hidden">{m.delete()}</span>
                  </button>
                </form>
              </AdminRowActions>
            </td>
          </tr>
        {/each}
      </AdminTable>

      <AdminPagination currentPage={data.currentPage} hasMore={data.hasMore} />
    {:else}
      <AdminEmptyState
        icon="fa-link"
        title={m.admin_invite_no_invites()}
        description={data.search ? m.admin_invite_no_results() : m.admin_invite_no_manage()}
      />
    {/if}
  </AdminPanel>
</AdminPage>
