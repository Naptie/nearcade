<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { adaptiveNewTab, formatDateTime, getDisplayName } from '$lib/utils';
  import {
    formatShopChangelogDescription,
    getShopChangelogActionBadgeClass,
    getShopChangelogActionIcon,
    getShopChangelogActionName,
    getShopChangelogFieldName
  } from '$lib/utils/shops/changelog';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import ChangelogValueDiff from '$lib/components/ChangelogValueDiff.svelte';
  import AdminPage from '$lib/components/admin/AdminPage.svelte';
  import AdminStats from '$lib/components/admin/AdminStats.svelte';
  import AdminToolbar from '$lib/components/admin/AdminToolbar.svelte';
  import AdminDateRange from '$lib/components/admin/AdminDateRange.svelte';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import AdminTable from '$lib/components/admin/AdminTable.svelte';
  import AdminPagination from '$lib/components/admin/AdminPagination.svelte';
  import AdminEmptyState from '$lib/components/admin/AdminEmptyState.svelte';
  import AdminRowActions from '$lib/components/admin/AdminRowActions.svelte';
  import type { PageData } from './$types';
  import type { AdminFilter } from '$lib/components/admin/AdminToolbar.svelte';

  let { data }: { data: PageData } = $props();

  const isFiltered = $derived(
    Boolean(data.search || data.action || data.field || data.userId || data.from || data.to)
  );

  /** Facet counts are computed on the search scope, so prefix them onto the label. */
  const withCount = (label: string, count: number | undefined) =>
    count === undefined ? label : `${label} (${count})`;

  const actionFilters = $derived<AdminFilter[]>([
    {
      name: 'action',
      label: m.admin_changelog_filter_action(),
      options: [
        { value: '', label: m.admin_changelog_all_actions() },
        ...data.facets.actions.map((facet) => ({
          value: facet.value,
          label: withCount(getShopChangelogActionName(facet.value, m), facet.count)
        }))
      ]
    },
    {
      name: 'field',
      label: m.admin_changelog_filter_field(),
      class: 'lg:w-56',
      options: [
        { value: '', label: m.admin_changelog_all_fields() },
        ...data.facets.fields.map((facet) => ({
          value: facet.value,
          label: withCount(getShopChangelogFieldName(facet.value, m), facet.count)
        }))
      ]
    },
    {
      name: 'userId',
      label: m.admin_changelog_filter_user(),
      class: 'lg:w-52',
      options: [
        { value: '', label: m.admin_changelog_all_users() },
        ...data.facets.users.map((facet) => ({
          value: facet.value,
          label: withCount(facet.label, facet.count)
        }))
      ]
    }
  ]);

  const PHOTO_ACTIONS = new Set([
    'photo_uploaded',
    'photo_deleted',
    'photo_delete_request_submitted',
    'photo_delete_request_approved',
    'photo_delete_request_rejected'
  ]);
</script>

<AdminPage title={m.admin_changelog()} description={m.admin_changelog_description()}>
  {#snippet actions()}
    <AdminStats
      stats={[
        { label: m.admin_changelog_total_entries(), value: data.totalCount },
        { label: m.total_shops(), value: data.facets.shopCount }
      ]}
    />
  {/snippet}

  <AdminToolbar
    placeholder={m.admin_changelog_search_placeholder()}
    filters={actionFilters}
    total={data.totalCount}
  >
    {#snippet advanced()}
      <AdminDateRange
        fromLabel={m.admin_changelog_filter_date_from()}
        toLabel={m.admin_changelog_filter_date_to()}
      />
    {/snippet}
  </AdminToolbar>

  <AdminPanel>
    {#if data.entries.length === 0}
      {#if isFiltered}
        <AdminEmptyState
          icon="fa-magnifying-glass"
          title={m.admin_changelog_no_results()}
          description={m.admin_changelog_no_results_description()}
        />
      {:else}
        <AdminEmptyState
          icon="fa-clock-rotate-left"
          title={m.admin_changelog_no_entries()}
          description={m.admin_changelog_no_entries_description()}
        />
      {/if}
    {:else}
      <AdminTable>
        {#snippet head()}
          <tr>
            <th>{m.admin_changelog_header_shop()}</th>
            <th>{m.admin_changelog_header_change()}</th>
            <th class="not-lg:hidden">{m.admin_changelog_header_action()}</th>
            <th class="not-md:hidden">{m.admin_changelog_header_user()}</th>
            <th class="text-right">{m.admin_changelog_header_time()}</th>
          </tr>
        {/snippet}

        {#each data.entries as entry (entry.id)}
          <tr class="hover">
            <td class="max-w-[22vw]">
              <a
                class="hover:text-accent font-medium transition-colors"
                href={resolve('/(main)/shops/[id]', { id: String(entry.shopId) })}
                target={adaptiveNewTab()}
              >
                {entry.shopName}
              </a>
              <div class="text-base-content/50 font-mono text-xs">
                #{entry.shopId}
              </div>
            </td>

            <td class="max-w-[36vw]">
              <div class="text-sm">
                {formatShopChangelogDescription(entry, m)}
              </div>

              {#if entry.oldValue || entry.newValue}
                <ChangelogValueDiff
                  class="mt-1"
                  oldValue={entry.oldValue}
                  newValue={entry.newValue}
                />
              {/if}

              {#if PHOTO_ACTIONS.has(entry.action) && entry.fieldInfo.photoUrl}
                <img
                  src={entry.fieldInfo.photoUrl}
                  alt=""
                  class="mt-2 h-12 w-12 rounded object-cover"
                  loading="lazy"
                />
              {/if}
            </td>

            <td class="not-lg:hidden">
              <span
                class="badge badge-soft badge-sm badge-nowrap {getShopChangelogActionBadgeClass(
                  entry.action
                )}"
              >
                <i class="fa-solid {getShopChangelogActionIcon(entry.action)} not-sm:hidden"></i>
                {getShopChangelogActionName(entry.action, m)}
              </span>
            </td>

            <td class="not-md:hidden">
              {#if entry.user}
                <div class="flex items-center gap-2">
                  <UserAvatar user={entry.user} size="sm" />
                  <a
                    class="hover:text-accent truncate text-sm transition-colors"
                    href={resolve('/(main)/users/[id]', {
                      id: entry.user.name ? `@${entry.user.name}` : (entry.userId ?? '')
                    })}
                    target={adaptiveNewTab()}
                  >
                    {getDisplayName(entry.user) || m.unknown_user()}
                  </a>
                </div>
              {:else}
                <span class="text-base-content/60 text-sm">{m.anonymous_user()}</span>
              {/if}
            </td>

            <td class="text-right">
              <AdminRowActions>
                <a
                  class="btn btn-soft btn-sm btn-square"
                  href={resolve('/(main)/shops/[id]', { id: String(entry.shopId) })}
                  target={adaptiveNewTab()}
                  title={m.view()}
                  aria-label={m.view()}
                >
                  <i class="fa-solid fa-eye"></i>
                </a>
              </AdminRowActions>
              <div class="text-base-content/60 mt-1 text-xs whitespace-nowrap">
                {formatDateTime(entry.createdAt)}
              </div>
            </td>
          </tr>
        {/each}
      </AdminTable>

      <AdminPagination
        currentPage={data.currentPage}
        hasMore={data.currentPage * data.pageSize < data.totalCount}
        total={data.totalCount}
        pageSize={data.pageSize}
      />
    {/if}
  </AdminPanel>
</AdminPage>
