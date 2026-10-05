<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { adaptiveNewTab, aggregateGames, formatShopAddress } from '$lib/utils';
  import AdminPage from '$lib/components/admin/AdminPage.svelte';
  import AdminStats from '$lib/components/admin/AdminStats.svelte';
  import AdminToolbar from '$lib/components/admin/AdminToolbar.svelte';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import AdminTable from '$lib/components/admin/AdminTable.svelte';
  import AdminPagination from '$lib/components/admin/AdminPagination.svelte';
  import AdminEmptyState from '$lib/components/admin/AdminEmptyState.svelte';
  import AdminRowActions from '$lib/components/admin/AdminRowActions.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Radius only affects the "explore nearby" deep link, so it is a client-side
  // preference rather than part of the shared toolbar state.
  let radius = $state(10);

  onMount(() => {
    const saved = localStorage.getItem('nearcade-radius');
    if (saved) radius = parseInt(saved, 10) || 10;
  });
</script>

<AdminPage title={m.admin_shops()} description={m.admin_shops_description()}>
  {#snippet actions()}
    <AdminStats stats={[{ label: m.total_shops(), value: data.shopStats?.total ?? 0 }]} />
  {/snippet}

  <AdminToolbar placeholder={m.admin_search_by_name()} total={data.totalCount} />

  <AdminPanel>
    {#if data.shops.length === 0}
      <AdminEmptyState
        icon="fa-gamepad"
        title={m.admin_no_shops_found()}
        description={data.search ? m.admin_no_shops_found_search() : m.admin_no_shops_found_empty()}
      />
    {:else}
      <AdminTable>
        {#snippet head()}
          <tr>
            <th>{m.admin_shop_header()}</th>
            <th class="not-lg:hidden">{m.admin_address_header()}</th>
            <th class="not-sm:hidden">{m.admin_games_header()}</th>
            <th class="text-right">{m.admin_actions_header()}</th>
          </tr>
        {/snippet}

        {#each data.shops as shop (shop._id)}
          {@const aggregatedGames = aggregateGames(shop)}
          <tr class="hover">
            <td class="max-w-[30vw]">
              <a
                class="hover:text-accent font-medium transition-colors"
                href={resolve('/(main)/shops/[id]', { id: shop.id.toString() })}
                target={adaptiveNewTab()}
              >
                {shop.name}
              </a>
            </td>

            <td class="max-w-[24vw] not-lg:hidden">
              <span class="text-sm opacity-60">{formatShopAddress(shop)}</span>
            </td>

            <td class="not-sm:hidden">
              {#if aggregatedGames.length > 0}
                <div class="flex flex-wrap gap-1">
                  {#each aggregatedGames.slice(0, 3) as game (game.titleId)}
                    <span class="badge badge-xs badge-soft">{game.name}</span>
                  {/each}
                  {#if aggregatedGames.length > 3}
                    <span class="badge badge-xs badge-soft">
                      +{aggregatedGames.length - 3}
                    </span>
                  {/if}
                </div>
              {/if}
            </td>

            <td>
              <AdminRowActions>
                <a
                  class="btn btn-soft btn-sm"
                  href="{resolve('/(main)/discover')}?longitude={shop.location
                    ?.coordinates[0]}&latitude={shop.location
                    ?.coordinates[1]}&name={shop.name}&radius={radius}"
                  target={adaptiveNewTab()}
                  title={m.explore_nearby()}
                >
                  <i class="fa-solid fa-map-location-dot"></i>
                  <span class="not-md:hidden">{m.explore_nearby()}</span>
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
