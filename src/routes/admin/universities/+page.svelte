<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import type { PageData } from './$types';
  import { adaptiveNewTab } from '$lib/utils';
  import AdminPage from '$lib/components/admin/AdminPage.svelte';
  import AdminToolbar from '$lib/components/admin/AdminToolbar.svelte';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import AdminTable from '$lib/components/admin/AdminTable.svelte';
  import AdminPagination from '$lib/components/admin/AdminPagination.svelte';
  import AdminEmptyState from '$lib/components/admin/AdminEmptyState.svelte';
  import AdminRowActions from '$lib/components/admin/AdminRowActions.svelte';

  let { data }: { data: PageData } = $props();
</script>

<AdminPage title={m.admin_universities()} description={m.admin_manage_universities()}>
  <!-- <a href={resolve('/(main)/universities/new')} class="btn btn-primary">
    <i class="fa-solid fa-plus"></i>
    Add University
  </a> -->

  <AdminToolbar placeholder={m.search_universities_placeholder()} total={data.totalCount} />

  <AdminPanel>
    {#if data.universities && data.universities.length > 0}
      <AdminTable>
        {#snippet head()}
          <tr>
            <th>{m.admin_university_header()}</th>
            <th>{m.admin_campuses_header()}</th>
            <th>{m.admin_clubs_header()}</th>
            <th>{m.admin_members_header()}</th>
            <th class="text-right">{m.admin_actions_header()}</th>
          </tr>
        {/snippet}

        {#each data.universities as university (university.id)}
          <tr class="hover">
            <td class="max-w-[40vw]">
              <a
                href={resolve('/(main)/universities/[id]', {
                  id: university.slug || university.id
                })}
                target={adaptiveNewTab()}
                class="group flex items-center gap-3"
              >
                {#if university.avatarUrl}
                  <img
                    src={university.avatarUrl}
                    alt="{university.name} {m.logo()}"
                    class="h-10 w-10 rounded-full bg-white"
                  />
                {:else}
                  <div
                    class="bg-primary/20 flex h-10 w-10 items-center justify-center rounded-full"
                  >
                    <i class="fa-solid fa-graduation-cap text-primary"></i>
                  </div>
                {/if}
                <div class="group-hover:text-accent w-[calc(100%-2.5rem)] transition-colors">
                  <div class="line-clamp-2 font-medium">
                    {university.name}
                  </div>
                  {#if university.description}
                    <div class="max-w-xs truncate text-sm opacity-60">
                      {university.description}
                    </div>
                  {/if}
                </div>
              </a>
            </td>
            <td>
              <div class="text-sm">
                {m.campus_count({ count: university.campuses.length || 0 })}
              </div>
            </td>
            <td>
              <div class="text-sm">
                {m.club_count({ count: university.clubsCount || 0 })}
              </div>
            </td>
            <td>
              <div class="text-sm">
                {m.member_count_people({ count: university.membersCount || 0 })}
              </div>
            </td>
            <td>
              <AdminRowActions>
                <a
                  href={resolve('/(main)/universities/[id]/edit', {
                    id: university.slug || university.id
                  })}
                  target={adaptiveNewTab()}
                  class="btn btn-primary btn-soft btn-sm text-nowrap"
                >
                  <i class="fa-solid fa-edit"></i>
                  <span class="not-md:hidden">{m.edit()}</span>
                </a>
                {#if data.session?.user?.userType === 'site_admin'}
                  <form method="POST" action="?/delete" use:enhance class="inline">
                    <input type="hidden" name="universityId" value={university.id} />
                    <button
                      type="button"
                      class="btn btn-error btn-sm btn-soft text-nowrap"
                      onclick={(e) =>
                        confirm(m.admin_university_delete_confirm()) &&
                        e.currentTarget.closest('form')?.requestSubmit()}
                    >
                      <i class="fa-solid fa-trash"></i>
                      <span class="not-md:hidden">{m.delete()}</span>
                    </button>
                  </form>
                {/if}
              </AdminRowActions>
            </td>
          </tr>
        {/each}
      </AdminTable>

      <AdminPagination
        currentPage={data.currentPage}
        hasMore={data.hasMore}
        total={data.totalCount}
        pageSize={data.pageSize}
      />
    {:else}
      <AdminEmptyState
        icon="fa-graduation-cap"
        title={m.admin_no_universities_found()}
        description={data.search
          ? m.admin_no_results_search_description()
          : m.no_universities_added_yet()}
      />
      <!-- {#if !data.search}
        <a href={resolve('/(main)/universities/new')} class="btn btn-primary mt-4">
          <i class="fa-solid fa-plus"></i>
          Add University
        </a>
      {/if} -->
    {/if}
  </AdminPanel>
</AdminPage>
