<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { formatDate } from '$lib/utils';
  import { isAnnouncementExpired } from '$lib/announcements/read';
  import AdminPage from '$lib/components/admin/AdminPage.svelte';
  import AdminToolbar from '$lib/components/admin/AdminToolbar.svelte';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import AdminTable from '$lib/components/admin/AdminTable.svelte';
  import AdminPagination from '$lib/components/admin/AdminPagination.svelte';
  import AdminEmptyState from '$lib/components/admin/AdminEmptyState.svelte';
  import AdminRowActions from '$lib/components/admin/AdminRowActions.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<AdminPage title={m.admin_announcements()} description={m.admin_announcements_description()}>
  {#snippet actions()}
    <a href={resolve('/(main)/announcements/new')} class="btn btn-primary">
      <i class="fa-solid fa-plus"></i>
      {m.new_announcement()}
    </a>
  {/snippet}

  <AdminToolbar placeholder={m.admin_search_by_title_or_content()} total={data.totalCount} />

  <AdminPanel>
    {#if data.announcements.length === 0}
      <AdminEmptyState
        icon="fa-bullhorn"
        title={m.no_announcements_yet()}
        description={m.no_announcements_description()}
      />
    {:else}
      <AdminTable>
        {#snippet head()}
          <tr>
            <th>{m.post_title()}</th>
            <th>{m.status()}</th>
            <th class="not-md:hidden">{m.created_at()}</th>
            <th class="text-right">{m.actions()}</th>
          </tr>
        {/snippet}

        {#each data.announcements as announcement (announcement.id)}
          <tr>
            <td>
              <a
                class="hover:text-accent font-medium"
                href={resolve('/(main)/announcements/[id]', { id: announcement.id })}
              >
                {announcement.title}
              </a>
            </td>
            <td>
              {#if announcement.status !== 'published'}
                <span class="badge badge-soft">{m.announcement_draft()}</span>
              {:else if announcement.publishedAt && new Date(announcement.publishedAt) > new Date()}
                <span class="badge badge-soft badge-info">{m.announcement_scheduled()}</span>
              {:else if isAnnouncementExpired(announcement)}
                <span class="badge badge-soft badge-warning">{m.expired()}</span>
              {:else}
                <span class="badge badge-soft badge-success">{m.announcement_published()}</span>
              {/if}
            </td>
            <td class="not-md:hidden">{formatDate(announcement.createdAt)}</td>
            <td class="text-right">
              <AdminRowActions>
                <a
                  class="btn btn-ghost btn-sm"
                  href={resolve('/(main)/announcements/[id]', { id: announcement.id })}
                  aria-label={m.view()}
                >
                  <i class="fa-solid fa-eye"></i>
                </a>
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
    {/if}
  </AdminPanel>
</AdminPage>
