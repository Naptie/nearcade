<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { adaptiveNewTab, formatDateTime, formatShopAddress, getDisplayName } from '$lib/utils';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
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
    Boolean(data.search || data.deletedBy || data.source || data.from || data.to)
  );

  /** Facet counts are computed on the search scope, so prefix them onto the label. */
  const withCount = (label: string, count: number | undefined) =>
    count === undefined ? label : `${label} (${count})`;

  const sourceLabel = (value: string) =>
    value === 'external'
      ? m.admin_deleted_shops_source_external()
      : m.admin_deleted_shops_source_request();

  const filters = $derived<AdminFilter[]>([
    {
      name: 'deletedBy',
      label: m.admin_deleted_shops_filter_admin(),
      class: 'lg:w-56',
      options: [
        { value: '', label: m.admin_deleted_shops_all_admins() },
        ...data.facets.admins.map((facet) => ({
          value: facet.value,
          label: withCount(facet.label, facet.count)
        }))
      ]
    },
    {
      name: 'source',
      label: m.admin_deleted_shops_filter_source(),
      options: [
        { value: '', label: m.admin_deleted_shops_all_sources() },
        ...data.facets.sources.map((facet) => ({
          value: facet.value,
          label: withCount(sourceLabel(facet.value), facet.count)
        }))
      ]
    }
  ]);
</script>

<AdminPage title={m.admin_deleted_shops()} description={m.admin_deleted_shops_description()}>
  {#snippet actions()}
    <AdminStats
      stats={[
        { label: m.admin_deleted_shops_total_deleted(), value: data.totalCount },
        { label: m.admin_deleted_shops_total_requests(), value: data.requestCount }
      ]}
    />
  {/snippet}

  <AdminToolbar
    placeholder={m.admin_deleted_shops_search_placeholder()}
    {filters}
    total={data.totalCount}
  >
    {#snippet advanced()}
      <AdminDateRange
        fromLabel={m.admin_deleted_shops_filter_date_from()}
        toLabel={m.admin_deleted_shops_filter_date_to()}
      />
    {/snippet}
  </AdminToolbar>

  <AdminPanel>
    {#if data.shops.length === 0}
      {#if isFiltered}
        <AdminEmptyState
          icon="fa-magnifying-glass"
          title={m.admin_deleted_shops_no_results()}
          description={m.admin_deleted_shops_no_results_description()}
        />
      {:else}
        <AdminEmptyState
          icon="fa-trash-can"
          title={m.admin_deleted_shops_no_entries()}
          description={m.admin_deleted_shops_no_entries_description()}
        />
      {/if}
    {:else}
      <AdminTable>
        {#snippet head()}
          <tr>
            <th>{m.admin_deleted_shops_header_shop()}</th>
            <th class="not-lg:hidden">{m.admin_deleted_shops_header_address()}</th>
            <th>{m.admin_deleted_shops_header_reason()}</th>
            <th class="not-md:hidden">{m.admin_deleted_shops_header_admin()}</th>
            <th class="text-right">{m.admin_deleted_shops_header_time()}</th>
          </tr>
        {/snippet}

        {#each data.shops as shop (shop._id)}
          <tr class="hover">
            <!-- The shop is gone from `shops`, so its public page is a 404.
                 Deliberately not linked. -->
            <td class="max-w-[22vw]">
              <span class="font-medium">{shop.name}</span>
              <div class="text-base-content/50 font-mono text-xs">#{shop.id}</div>
            </td>

            <td class="max-w-[22vw] not-lg:hidden">
              <span class="text-sm opacity-60">{formatShopAddress(shop)}</span>
            </td>

            <td class="max-w-[30vw]">
              {#if shop.deleteRequest}
                <div class="text-sm">{shop.deleteRequest.reason}</div>

                {#if shop.deleteRequest.reviewNote}
                  <div class="text-base-content/60 mt-1 text-xs">
                    <span class="font-medium">{m.admin_deleted_shops_review_note()}:</span>
                    {shop.deleteRequest.reviewNote}
                  </div>
                {/if}

                {#if shop.deleteRequest.requestedByName || shop.deleteRequest.requestedBy}
                  <div class="text-base-content/50 mt-1 text-xs">
                    {m.admin_deleted_shops_requested_by()}
                    {shop.deleteRequest.requestedByName ?? shop.deleteRequest.requestedBy}
                  </div>
                {/if}
              {:else}
                <span class="text-base-content/50 text-sm italic">
                  {m.admin_deleted_shops_no_request()}
                </span>
              {/if}
            </td>

            <td class="not-md:hidden">
              {#if shop.deletedByUser}
                <div class="flex items-center gap-2">
                  <UserAvatar user={shop.deletedByUser} size="sm" />
                  <a
                    class="hover:text-accent truncate text-sm transition-colors"
                    href={resolve('/(main)/users/[id]', {
                      id: shop.deletedByUser.name
                        ? `@${shop.deletedByUser.name}`
                        : (shop.deletedBy ?? '')
                    })}
                    target={adaptiveNewTab()}
                  >
                    {getDisplayName(shop.deletedByUser) || m.unknown_user()}
                  </a>
                </div>
              {:else}
                <span class="text-base-content/60 text-sm">
                  {shop.deletedBy ?? m.anonymous_user()}
                </span>
              {/if}
            </td>

            <td class="text-right">
              <div class="flex justify-end">
                <AdminRowActions>
                  {#if shop.deleteRequest}
                    <a
                      class="btn btn-soft btn-sm btn-square"
                      href={resolve('/(main)/shops/delete-requests/[id]', {
                        id: shop.deleteRequest.id
                      })}
                      target={adaptiveNewTab()}
                      title={m.admin_deleted_shops_header_reason()}
                      aria-label={m.admin_deleted_shops_header_reason()}
                    >
                      <i class="fa-solid fa-file-lines"></i>
                    </a>
                  {/if}
                </AdminRowActions>
              </div>
              <div class="text-base-content/60 mt-1 text-xs whitespace-nowrap">
                {formatDateTime(shop.deletedAt)}
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
