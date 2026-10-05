<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';
  import { adaptiveNewTab, formatDate } from '$lib/utils';
  import AdminPage from '$lib/components/admin/AdminPage.svelte';
  import AdminToolbar from '$lib/components/admin/AdminToolbar.svelte';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import AdminTable from '$lib/components/admin/AdminTable.svelte';
  import AdminPagination from '$lib/components/admin/AdminPagination.svelte';
  import AdminEmptyState from '$lib/components/admin/AdminEmptyState.svelte';
  import AdminRowActions from '$lib/components/admin/AdminRowActions.svelte';

  let { data }: { data: PageData } = $props();

  let selectedUniversity = $state('');
  let showCreateModal = $state(false);
</script>

<AdminPage title={m.admin_clubs()} description={m.admin_clubs_description()}>
  {#snippet actions()}
    <button onclick={() => (showCreateModal = true)} class="btn btn-primary not-sm:btn-circle">
      <i class="fa-solid fa-plus"></i>
      <span class="not-sm:hidden">{m.add_club()}</span>
    </button>
  {/snippet}

  <AdminToolbar placeholder={m.search_clubs()} />

  <AdminPanel>
    {#if data.clubs && data.clubs.length > 0}
      <AdminTable>
        {#snippet head()}
          <tr>
            <th>{m.club()}</th>
            <th>{m.admin_university_header()}</th>
            <th class="not-sm:hidden">{m.admin_members_header()}</th>
            <th class="not-md:hidden">{m.admin_status_header()}</th>
            <th class="not-lg:hidden">{m.admin_created_header()}</th>
            <th class="text-right">{m.admin_actions_header()}</th>
          </tr>
        {/snippet}

        {#each data.clubs as club (club.id)}
          <tr class="hover">
            <td class="max-w-[40vw]">
              <a
                href={resolve('/(main)/clubs/[id]', { id: club.id })}
                target={adaptiveNewTab()}
                class="group flex items-center gap-3"
              >
                {#if club.avatarUrl}
                  <img
                    src={club.avatarUrl}
                    alt={club.name}
                    class="bg-base-200 h-10 w-10 rounded-full"
                  />
                {:else}
                  <div
                    class="bg-primary/20 flex h-10 w-10 items-center justify-center rounded-full"
                  >
                    <i class="fa-solid fa-users text-primary"></i>
                  </div>
                {/if}
                <div class="group-hover:text-accent w-[calc(100%-2.5rem)] transition-colors">
                  <div class="line-clamp-2 font-medium">
                    {club.name}
                  </div>
                  {#if club.description}
                    <div class="max-w-xs truncate text-sm opacity-60">
                      {club.description}
                    </div>
                  {/if}
                </div>
              </a>
            </td>
            <td>
              {#if club.university}
                <a
                  href={resolve('/(main)/universities/[id]', { id: club.university.id })}
                  class="hover:text-accent line-clamp-2 transition-colors"
                >
                  {club.university.name}
                </a>
              {:else}
                <span class="text-base-content/60">{m.admin_unknown()}</span>
              {/if}
            </td>
            <td class="not-sm:hidden">
              <div class="text-sm">
                {m.member_count_people({ count: club.membersCount || 0 })}
              </div>
            </td>
            <td class="not-md:hidden">
              <div
                class="badge badge-soft text-nowrap {club.acceptJoinRequests
                  ? 'badge-success'
                  : 'badge-neutral'}"
              >
                {club.acceptJoinRequests ? m.is_open() : m.invite_only()}
              </div>
            </td>
            <td class="not-lg:hidden">
              <div class="text-sm">
                {formatDate(club.createdAt)}
              </div>
            </td>
            <td>
              <AdminRowActions>
                <a
                  href={resolve('/(main)/clubs/[id]/edit', { id: club.id })}
                  target={adaptiveNewTab()}
                  class="btn btn-primary btn-soft btn-sm text-nowrap"
                >
                  <i class="fa-solid fa-edit"></i>
                  <span class="not-lg:hidden">{m.edit()}</span>
                </a>
                <form method="POST" action="?/delete" use:enhance class="inline">
                  <input type="hidden" name="clubId" value={club.id} />
                  <button
                    type="button"
                    class="btn btn-error btn-sm btn-soft text-nowrap"
                    onclick={(e) =>
                      confirm(m.admin_club_delete_confirm()) &&
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
      <AdminEmptyState icon="fa-users" title={m.admin_no_clubs_found()}>
        {#snippet action()}
          {#if !data.search}
            <button onclick={() => (showCreateModal = true)} class="btn btn-primary">
              <i class="fa-solid fa-plus"></i>
              {m.add_club()}
            </button>
          {/if}
        {/snippet}
      </AdminEmptyState>
    {/if}
  </AdminPanel>
</AdminPage>

<!-- Create Club Modal -->
<div class="modal" class:modal-open={showCreateModal}>
  <div class="modal-box">
    <h3 class="mb-4 text-lg font-bold">{m.add_club()}</h3>
    <p class="text-base-content/60 mb-4 text-sm">
      {m.admin_club_creation_info()}
    </p>

    <div class="form-control w-full">
      <label class="label" for="university-select">
        <span class="label-text font-medium">{m.select_university()}</span>
      </label>
      <select
        id="university-select"
        class="select select-bordered w-full"
        bind:value={selectedUniversity}
      >
        <option value="">{m.choose_university()}</option>
        {#each data.universities || [] as university (university.id)}
          <option value={university.id}>{university.name}</option>
        {/each}
      </select>
    </div>

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={() => (showCreateModal = false)}>
        {m.cancel()}
      </button>
      <a
        href={selectedUniversity
          ? resolve('/(main)/clubs/new') + `?university=${selectedUniversity}`
          : '#'}
        class="btn btn-primary"
        class:btn-disabled={!selectedUniversity}
        onclick={() => {
          if (selectedUniversity) {
            showCreateModal = false;
          }
        }}
      >
        {m.continue()}
      </a>
    </div>
  </div>
  <div
    class="modal-backdrop"
    onclick={() => (showCreateModal = false)}
    onkeydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
    role="button"
    tabindex="0"
    aria-label={m.close_modal()}
  ></div>
</div>
