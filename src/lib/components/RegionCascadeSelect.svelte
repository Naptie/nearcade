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
    /** Bindable: whether the last selected option is a leaf node. */
    regionComplete?: boolean;
    /** Initial region IDs to pre-populate (e.g. when editing). */
    initialRegionIds?: string[];
    /** CSS class for the grid container. */
    gridClass?: string;
  };

  let {
    regionIds = $bindable<string[]>(),
    regionComplete = $bindable<boolean>(),
    initialRegionIds,
    gridClass = 'grid grid-cols-2 gap-1'
  }: Props = $props();

  // ---- State ----

  const REGIONS_ENDPOINT = `${base}/api/regions`;

  let regionLevels = $state<RegionLevel[]>([]);
  let regionPrefilled = $state(false);

  // Derive outputs from internal state.
  $effect(() => {
    regionIds = regionLevels.filter((l) => l.selectedId).map((l) => l.selectedId);
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
    const truncated = regionLevels
      .slice(0, levelIndex + 1)
      .map((l, i) => (i === levelIndex ? { ...l, selectedId: value } : l));

    if (!value) {
      regionLevels = truncated;
      return;
    }

    const level = truncated[levelIndex];
    const selected = level.options.find((o) => o.value === value);

    if (selected?.hasChildren) {
      try {
        const childOptions = await fetchRegionOptions(value);
        regionLevels = [...truncated, { options: childOptions, selectedId: '' }];
      } catch (err) {
        console.error(err);
        regionLevels = truncated;
      }
    } else {
      regionLevels = truncated;
    }
  }

  // ---- Pre-population ----

  $effect(() => {
    if (regionPrefilled) return;
    if (regionLevels.length === 0 || regionLevels[0].options.length === 0) return;
    if (!initialRegionIds || initialRegionIds.length === 0) return;

    regionPrefilled = true;

    const ids = initialRegionIds;

    (async () => {
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

      regionLevels = levels;
    })().catch(console.error);
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
