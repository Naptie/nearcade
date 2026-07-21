<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import type { Region } from '$lib/regions/types';
  import { pageTitle } from '$lib/utils';
  import RegionTreeNode from '$lib/components/admin/RegionTreeNode.svelte';
  import RegionEditModal from '$lib/components/admin/RegionEditModal.svelte';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state('');
  let editingRegion = $state<Region | null>(null);
  let isEditModalOpen = $state(false);
  let deleteError = $state('');

  const childrenMap = $derived.by(() => {
    const map: Record<string, Region[]> = {};
    for (const region of data.regions) {
      const key = region.parentId ?? 'null';
      if (!map[key]) map[key] = [];
      map[key].push(region);
    }
    for (const children of Object.values(map)) {
      children.sort((a, b) => a.id.localeCompare(b.id));
    }
    return map;
  });

  const matchesSearch = (region: Region, query: string): boolean => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      region.id.toLowerCase().includes(q) ||
      Object.values(region.name).some((n) => n?.toLowerCase().includes(q))
    );
  };

  const collectVisibleRegions = (
    regions: Region[],
    query: string
  ): { region: Region; hasMatchingDescendant: boolean }[] => {
    return regions.map((region) => {
      const children = childrenMap[region.id] ?? [];
      const childResults = collectVisibleRegions(children, query);
      const hasMatchingDescendant = childResults.some((r) => r.hasMatchingDescendant);
      const selfMatch = matchesSearch(region, query);
      return {
        region,
        hasMatchingDescendant: selfMatch || hasMatchingDescendant
      };
    });
  };

  const topLevelRegions = $derived(childrenMap['null'] ?? []);

  const visibleTopLevel = $derived.by(() => {
    if (!searchQuery.trim()) return topLevelRegions;
    const results = collectVisibleRegions(topLevelRegions, searchQuery.trim());
    return results.filter((r) => r.hasMatchingDescendant).map((r) => r.region);
  });

  const handleEdit = (region: Region) => {
    editingRegion = region;
    isEditModalOpen = true;
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
      await goto(page.url, { invalidateAll: true });
    } catch (err) {
      console.error('Error deleting region:', err);
      deleteError = m.region_delete_failed();
    }
  };

  const handleSaved = () => {
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
    {#if visibleTopLevel.length > 0}
      <ul class="divide-base-200 divide-y">
        {#each visibleTopLevel as region (region.id)}
          <RegionTreeNode
            {region}
            {childrenMap}
            ancestors={[]}
            depth={0}
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
        <p class="text-base-content/60">
          {searchQuery.trim()
            ? m.admin_no_regions_found_search()
            : m.admin_no_regions_found_empty()}
        </p>
      </div>
    {/if}
  </div>
</div>

<RegionEditModal
  region={editingRegion}
  bind:isOpen={isEditModalOpen}
  onClose={() => (editingRegion = null)}
  onSaved={handleSaved}
/>
