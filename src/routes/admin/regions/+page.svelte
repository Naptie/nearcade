<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getLocale } from '$lib/paraglide/runtime';
  import type { PageData } from './$types';
  import type { Region, AdminRegionNode, AdminRegionSearchHit } from '$lib/regions/types';
  import { adaptiveNewTab, pageTitle } from '$lib/utils';
  import RegionTreeNode from '$lib/components/admin/RegionTreeNode.svelte';
  import RegionEditModal from '$lib/components/admin/RegionEditModal.svelte';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state('');
  let editingRegion = $state<Region | null>(null);
  let isEditModalOpen = $state(false);
  let deleteError = $state('');

  // Lazily-loaded children, keyed by parent region ID. Populated on demand as
  // the admin expands each tree node.
  let childrenMap = $state<Record<string, AdminRegionNode[]>>({});
  // Bumping this key remounts the tree, collapsing every node after a mutation.
  let refreshKey = $state(0);

  // Server-side search results (flat hits with ancestor chains).
  let searchResults = $state<AdminRegionSearchHit[] | null>(null);
  let isSearching = $state(false);
  let searchSeq = 0;

  const searchActive = $derived(searchQuery.trim().length > 0);

  $effect(() => {
    const query = searchQuery.trim();
    if (!query) {
      searchResults = null;
      isSearching = false;
      return;
    }

    isSearching = true;
    const seq = ++searchSeq;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/regions?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Region search failed');
        const result = (await response.json()) as { regions: AdminRegionSearchHit[] };
        if (seq === searchSeq) {
          searchResults = result.regions;
        }
      } catch (err) {
        console.error('Error searching regions:', err);
        if (seq === searchSeq) {
          searchResults = [];
        }
      } finally {
        if (seq === searchSeq) {
          isSearching = false;
        }
      }
    }, 300);

    return () => clearTimeout(timer);
  });

  const loadChildren = async (parentId: string) => {
    try {
      const response = await fetch(`/api/admin/regions?parentId=${encodeURIComponent(parentId)}`);
      if (!response.ok) throw new Error('Failed to load region children');
      const result = (await response.json()) as { regions: AdminRegionNode[] };
      childrenMap[parentId] = result.regions;
    } catch (err) {
      console.error('Error loading region children:', err);
      childrenMap[parentId] = [];
    }
  };

  const locale = getLocale();
  const nameFor = (name: Record<string, string>): string =>
    name[locale] ?? name.en ?? Object.values(name).find(Boolean) ?? '';

  const levelLabelFor = (level: AdminRegionNode['level']): string => {
    const f = m[`region_level_${level}`];
    return typeof f === 'function' ? f() : level;
  };

  const formatNumber = (value: number | null): string =>
    value == null ? '—' : value.toLocaleString();

  const searchHitGlobeUrl = (hit: AdminRegionSearchHit): string => {
    if (!hit.location) return '';
    const zoomMap: Record<string, number> = { country: 6, province: 8, city: 10, county: 12 };
    const chain = [
      ...hit.ancestors.map((a) => ({ id: a.id, name: a.name })),
      { id: hit.id, name: hit.name }
    ];
    const [lng, lat] = hit.location.coordinates;
    const params = new URLSearchParams({
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
      zoom: (zoomMap[hit.level] ?? 8).toString(),
      region: btoa(encodeURIComponent(JSON.stringify(chain)))
    });
    return resolve('/(globe)/globe') + '?' + params.toString();
  };

  const handleEdit = (region: Region) => {
    editingRegion = region;
    isEditModalOpen = true;
  };

  // Clear lazy state and return to a fresh, collapsed tree.
  const resetTree = () => {
    searchQuery = '';
    childrenMap = {};
    refreshKey++;
  };

  const handleDelete = async (region: Region) => {
    if (!confirm(m.region_delete_confirm())) return;
    deleteError = '';
    try {
      const response = await fetch(`/api/admin/regions/${region.id}`, {
        method: 'DELETE'
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        deleteError = result.error ?? m.region_delete_failed();
        return;
      }
      resetTree();
      await goto(page.url, { invalidateAll: true });
    } catch (err) {
      console.error('Error deleting region:', err);
      deleteError = m.region_delete_failed();
    }
  };

  const handleSaved = () => {
    resetTree();
    goto(page.url, { invalidateAll: true });
  };
</script>

<svelte:head>
  <title>{pageTitle(m.admin_regions(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div class="not-sm:text-center">
      <h1 class="text-base-content text-3xl font-bold">{m.admin_regions()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_regions_description()}</p>
    </div>
  </div>

  {#if deleteError}
    <div class="alert alert-error">
      <i class="fa-solid fa-circle-xmark"></i>
      <span>{deleteError}</span>
    </div>
  {/if}

  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <div class="form-control">
      <label class="label" for="search">
        <span class="label-text font-medium">{m.search()}</span>
      </label>
      <input
        id="search"
        type="text"
        class="input input-bordered w-full"
        placeholder={m.admin_regions_search_placeholder()}
        bind:value={searchQuery}
      />
    </div>
  </div>

  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if searchActive}
      {#if isSearching}
        <div class="text-base-content/60 flex items-center justify-center gap-2 py-12">
          <span class="loading loading-spinner"></span>
          <span>{m.loading()}</span>
        </div>
      {:else if (searchResults ?? []).length > 0}
        <ul class="divide-base-200 divide-y">
          {#each searchResults ?? [] as hit (hit.id)}
            <li class="hover:bg-base-200/50 px-3 py-2 transition-colors">
              {#if hit.ancestors.length > 0}
                <div class="text-base-content/50 mb-1 flex flex-wrap items-center gap-1 text-xs">
                  {#each hit.ancestors as ancestor (ancestor.id)}
                    <span>{nameFor(ancestor.name)}</span>
                    <i class="fa-solid fa-chevron-right text-[0.6rem]"></i>
                  {/each}
                </div>
              {/if}
              <div class="flex flex-wrap items-center gap-2">
                <span class="badge badge-sm badge-soft uppercase">{levelLabelFor(hit.level)}</span>
                <span class="font-medium">{nameFor(hit.name)}</span>
                <span class="text-base-content/50 text-xs">{hit.id}</span>
              </div>
              <div class="mt-1 flex flex-wrap items-center justify-between gap-2">
                <div class="text-base-content/60 flex flex-wrap gap-3 text-xs">
                  <span>{m.region_area()}: {formatNumber(hit.area)} km²</span>
                  <span>{m.region_population()}: {formatNumber(hit.population)}</span>
                </div>
                <div class="flex items-center gap-1">
                  {#if searchHitGlobeUrl(hit)}
                    <a
                      href={searchHitGlobeUrl(hit)}
                      target={adaptiveNewTab()}
                      class="btn btn-ghost btn-sm"
                      title={m.region_view_in_globe()}
                    >
                      <i class="fa-solid fa-globe"></i>
                    </a>
                  {/if}
                  <button
                    type="button"
                    class="btn btn-primary btn-soft btn-sm"
                    onclick={() => handleEdit(hit)}
                    title={m.edit()}
                  >
                    <i class="fa-solid fa-edit"></i>
                    <span class="not-md:hidden">{m.edit()}</span>
                  </button>
                  <button
                    type="button"
                    class="btn btn-error btn-soft btn-sm"
                    onclick={() => handleDelete(hit)}
                    title={m.delete()}
                  >
                    <i class="fa-solid fa-trash"></i>
                    <span class="not-md:hidden">{m.delete()}</span>
                  </button>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="py-12 text-center">
          <i class="fa-solid fa-map-location-dot text-base-content/40 mb-4 text-4xl"></i>
          <h3 class="text-base-content mb-2 text-lg font-semibold">
            {m.admin_no_regions_found()}
          </h3>
          <p class="text-base-content/60">{m.admin_no_regions_found_search()}</p>
        </div>
      {/if}
    {:else}
      {#key refreshKey}
        {#if data.regions.length > 0}
          <ul class="divide-base-200 divide-y">
            {#each data.regions as region (region.id)}
              <RegionTreeNode
                {region}
                {childrenMap}
                ancestors={[]}
                depth={0}
                {loadChildren}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            {/each}
          </ul>
        {:else}
          <div class="py-12 text-center">
            <i class="fa-solid fa-map-location-dot text-base-content/40 mb-4 text-4xl"></i>
            <h3 class="text-base-content mb-2 text-lg font-semibold">
              {m.admin_no_regions_found()}
            </h3>
            <p class="text-base-content/60">{m.admin_no_regions_found_empty()}</p>
          </div>
        {/if}
      {/key}
    {/if}
  </div>
</div>

<RegionEditModal
  region={editingRegion}
  bind:isOpen={isEditModalOpen}
  onClose={() => (editingRegion = null)}
  onSaved={handleSaved}
/>
