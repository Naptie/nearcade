<script lang="ts">
  /* eslint-disable no-useless-assignment */
  import { base } from '$app/paths';
  import { getLocale } from '$lib/paraglide/runtime';
  import { m } from '$lib/paraglide/messages';

  // ---- Types ----

  export type RegionOption = {
    id: string;
    value: string;
    label: string;
    hasChildren: boolean;
  };

  export type RegionLevel = {
    options: RegionOption[];
    selectedId: string;
  };

  type Props = {
    /** Bindable: selected region IDs from root → leaf. */
    regionIds?: string[];
    /** Bindable: localized labels of the selected chain, root → leaf. Empty
     *  entries are dropped, so it is always index-aligned with `regionIds`. */
    selectedLabels?: string[];
    /** Bindable: whether the last selected option is a leaf node. */
    regionComplete?: boolean;
    /** Initial region IDs to pre-populate (e.g. when editing). */
    initialRegionIds?: string[];
    /** Region IDs resolved externally (e.g. from a location pick); when it
     *  changes to a new non-empty chain, the cascade re-resolves and selects it. */
    resolvedRegionIds?: string[];
    /** Change this value to clear the cascade back to the top level. */
    resetKey?: number;
    /** CSS class for the grid container. */
    gridClass?: string;
  };

  let {
    regionIds = $bindable<string[]>(),
    selectedLabels = $bindable<string[]>(),
    regionComplete = $bindable<boolean>(),
    initialRegionIds,
    resolvedRegionIds,
    resetKey,
    gridClass = 'grid grid-cols-2 gap-1'
  }: Props = $props();

  // ---- State ----

  const REGIONS_ENDPOINT = `${base}/api/regions`;

  let regionLevels = $state<RegionLevel[]>([]);
  let regionPrefilled = $state(false);
  // Invalidate in-flight requests whenever a newer selection or reset wins.
  let selectionVersion = 0;

  // Derive outputs from internal state.
  $effect(() => {
    regionIds = regionLevels.filter((l) => l.selectedId).map((l) => l.selectedId);
  });

  $effect(() => {
    selectedLabels = regionLevels
      .filter((l) => l.selectedId)
      .map((l) => l.options.find((o) => o.value === l.selectedId)?.label ?? l.selectedId);
  });

  $effect(() => {
    if (regionLevels.length === 0) {
      regionComplete = false;
      return;
    }
    const lastLevel = regionLevels[regionLevels.length - 1];
    if (!lastLevel.selectedId) {
      regionComplete = false;
      return;
    }
    const selected = lastLevel.options.find((o) => o.value === lastLevel.selectedId);
    regionComplete = selected ? !selected.hasChildren : false;
  });

  // ---- Fetching ----

  async function fetchRegionOptions(parentId: string | null): Promise<RegionOption[]> {
    const response = await fetch(
      `${REGIONS_ENDPOINT}?locale=${getLocale()}${parentId ? `&parentId=${encodeURIComponent(parentId)}` : ''}`
    );
    if (!response.ok) throw new Error('Failed to load region options');
    return (await response.json()) as RegionOption[];
  }

  // Load top-level regions (countries) on mount.
  $effect(() => {
    fetchRegionOptions(null)
      .then((options) => {
        regionLevels = [{ options, selectedId: '' }];
      })
      .catch(console.error);
  });

  // ---- Selection handling ----

  async function handleRegionSelect(levelIndex: number, value: string) {
    const version = ++selectionVersion;
    const truncated = regionLevels
      .slice(0, levelIndex + 1)
      .map((l, i) => (i === levelIndex ? { ...l, selectedId: value } : l));

    // Publish the selection immediately so Apply can use it while children load.
    regionLevels = truncated;
    if (!value) return;

    const level = truncated[levelIndex];
    const selected = level.options.find((o) => o.value === value);

    if (selected?.hasChildren) {
      try {
        const childOptions = await fetchRegionOptions(value);
        if (version !== selectionVersion) return;
        regionLevels = [...truncated, { options: childOptions, selectedId: '' }];
      } catch (err) {
        if (version !== selectionVersion) return;
        console.error(err);
      }
    }
  }

  // ---- Pre-population ----

  /** Re-resolve the cascade levels from a full region-ID chain. */
  async function applyRegionIds(ids: string[]) {
    const version = ++selectionVersion;
    const response = await fetch(`${REGIONS_ENDPOINT}/${ids.join('/')}?locale=${getLocale()}`);
    if (!response.ok) throw new Error('Failed to resolve region hierarchy');

    const data = (await response.json()) as {
      levels: {
        region: { id: string; label: string; level: string; hasChildren: boolean };
        options: RegionOption[];
      }[];
    };

    const levels: RegionLevel[] = data.levels.map((l) => ({
      options: l.options,
      selectedId: l.region.id
    }));

    // If the last selected region has children, load one more empty level.
    const last = data.levels[data.levels.length - 1];
    if (last?.region.hasChildren) {
      const childOptions = await fetchRegionOptions(last.region.id);
      levels.push({ options: childOptions, selectedId: '' });
    }

    if (version !== selectionVersion) return;
    regionLevels = levels;
  }

  $effect(() => {
    if (regionPrefilled) return;
    if (regionLevels.length === 0 || regionLevels[0].options.length === 0) return;
    if (!initialRegionIds || initialRegionIds.length === 0) return;

    regionPrefilled = true;
    applyRegionIds(initialRegionIds).catch(console.error);
  });

  // Re-resolve when a location pick resolves a new region chain externally.
  let lastResolvedKey = '';
  $effect(() => {
    const ids = resolvedRegionIds;
    if (!ids || ids.length === 0) return;
    const key = ids.join('/');
    if (key === lastResolvedKey) return;
    if (regionLevels.length === 0 || regionLevels[0].options.length === 0) return;
    lastResolvedKey = key;
    applyRegionIds(ids).catch(console.error);
  });

  // Clear the cascade back to the top level when the consumer bumps `resetKey`.
  let lastResetKey = $state<number | undefined>(undefined);
  $effect(() => {
    const key = resetKey;
    if (key === undefined || key === lastResetKey) return;
    lastResetKey = key;
    if (regionLevels.length === 0) return;
    selectionVersion += 1;
    // Reuse the already-loaded top level; only the selection is dropped.
    regionLevels = [{ ...regionLevels[0], selectedId: '' }];
  });
</script>

<div class={gridClass}>
  {#each regionLevels as level, levelIdx (levelIdx)}
    <select
      class="select select-bordered w-full"
      class:col-span-2={levelIdx === 0 && regionLevels.length === 1}
      value={level.selectedId}
      onchange={(e) => handleRegionSelect(levelIdx, (e.target as HTMLSelectElement).value)}
    >
      <option value="">{m.shop_select_region()}</option>
      {#each level.options as option (option.id)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  {/each}
</div>
