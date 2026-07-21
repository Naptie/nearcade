<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { resolve } from '$app/paths';
  import { adaptiveNewTab } from '$lib/utils';
  import type { Region } from '$lib/regions/types';
  import RegionTreeNode from './RegionTreeNode.svelte';

  type Props = {
    region: Region;
    childrenMap: Record<string, Region[]>;
    ancestors: Region[];
    depth?: number;
    onEdit: (region: Region) => void;
    onDelete: (region: Region) => void;
  };

  let { region, childrenMap, ancestors, depth = 0, onEdit, onDelete }: Props = $props();

  let expanded = $state((() => depth < 1)());

  const children = $derived(childrenMap[region.id] ?? []);
  const hasChildren = $derived(children.length > 0);

  const locale = getLocale();
  const localizedName = $derived(
    region.name[locale] ?? region.name.en ?? Object.values(region.name).find(Boolean) ?? region.id
  );

  const levelLabel = $derived.by(() => {
    const f = m[`region_level_${region.level}`];
    return typeof f === 'function' ? f() : region.level;
  });

  const chain = $derived([
    ...ancestors.map((a) => ({ id: a.id, name: a.name })),
    { id: region.id, name: region.name }
  ]);

  const globeUrl = $derived.by(() => {
    const zoomMap: Record<Region['level'], number> = {
      country: 6,
      province: 8,
      city: 10,
      county: 12
    };
    let lng: number | null = null;
    let lat: number | null = null;
    for (let i = chain.length - 1; i >= 0; i--) {
      const r = i === chain.length - 1 ? region : ancestors[i];
      if (r?.location) {
        lng = r.location.coordinates[0];
        lat = r.location.coordinates[1];
        break;
      }
    }
    if (lat == null || lng == null) return '';
    const params = new URLSearchParams({
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
      zoom: (zoomMap[region.level] ?? 8).toString(),
      region: btoa(encodeURIComponent(JSON.stringify(chain)))
    });
    return resolve('/(globe)/globe') + '?' + params.toString();
  });

  const formatNumber = (value: number | null): string => {
    if (value == null) return '—';
    return value.toLocaleString();
  };
</script>

<li class="border-base-200 {depth > 0 ? 'border-t' : ''}">
  <div
    class="hover:bg-base-200/50 flex items-center gap-2 px-3 py-2 transition-colors"
    style="padding-left: {depth * 1.25 + 0.75}rem"
  >
    <button
      type="button"
      class="btn btn-ghost btn-circle btn-xs {hasChildren ? '' : 'invisible'}"
      onclick={() => (expanded = !expanded)}
      aria-label={expanded ? m.collapse() : m.expand()}
    >
      <i class="fa-solid {expanded ? 'fa-chevron-down' : 'fa-chevron-right'}"></i>
    </button>

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge badge-sm badge-soft uppercase">{levelLabel}</span>
        <span class="font-medium">{localizedName}</span>
        <span class="text-base-content/50 text-xs">{region.id}</span>
      </div>
      <div class="text-base-content/60 mt-0.5 flex flex-wrap gap-3 text-xs">
        <span>{m.region_area()}: {formatNumber(region.area)}</span>
        <span>{m.region_population()}: {formatNumber(region.population)}</span>
        {#if !region.location}
          <span class="text-base-content/40">{m.region_no_location()}</span>
        {/if}
      </div>
    </div>

    <div class="flex items-center gap-1">
      {#if globeUrl}
        <a
          href={globeUrl}
          target={adaptiveNewTab()}
          class="btn btn-ghost btn-sm"
          title={m.region_view_in_globe()}
        >
          <i class="fa-solid fa-globe"></i>
          <span class="not-md:hidden">{m.region_view_in_globe()}</span>
        </a>
      {:else}
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-disabled"
          title={m.region_no_location()}
          disabled
        >
          <i class="fa-solid fa-globe"></i>
        </button>
      {/if}

      <button
        type="button"
        class="btn btn-primary btn-soft btn-sm"
        onclick={() => onEdit(region)}
        title={m.edit()}
      >
        <i class="fa-solid fa-edit"></i>
        <span class="not-md:hidden">{m.edit()}</span>
      </button>

      <button
        type="button"
        class="btn btn-error btn-soft btn-sm"
        onclick={() => onDelete(region)}
        title={m.delete()}
      >
        <i class="fa-solid fa-trash"></i>
        <span class="not-md:hidden">{m.delete()}</span>
      </button>
    </div>
  </div>

  {#if expanded && hasChildren}
    <ul>
      {#each children as child (child.id)}
        <RegionTreeNode
          region={child}
          {childrenMap}
          ancestors={[...ancestors, region]}
          depth={depth + 1}
          {onEdit}
          {onDelete}
        />
      {/each}
    </ul>
  {/if}
</li>
