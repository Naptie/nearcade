<script lang="ts">
  import { untrack } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { GAME_TITLES, RADIUS_OPTIONS } from '$lib/constants';
  import { getGameName, getMyLocation } from '$lib/utils';
  import FilterSectionCard from '$lib/components/FilterSectionCard.svelte';
  import RegionCascadeSelect from '$lib/components/RegionCascadeSelect.svelte';
  import { toastError } from '$lib/notifications/toast.svelte';
  import {
    SHOP_FILTER_MAX_DEPTH,
    SHOP_FILTER_MAX_REGIONS,
    emptyShopFilterState,
    type ShopFilterGameExpr,
    type ShopFilterGameLeaf,
    type ShopFilterState
  } from '$lib/schemas/shop-filter';
  import type { AddressRegionEntry, RegionDisplayLabel } from '$lib/regions/types';
  import { regionLabelFromChain } from '$lib/regions/labels';
  import {
    countActiveFilters,
    sanitizeShopFilterState,
    withoutGeoFilter
  } from '$lib/utils/shops/filter';

  type GameChild = NonNullable<ShopFilterState['games']>['children'][number];

  interface Props {
    /** The applied filter (server-driven); the draft is seeded from it on open. */
    applied: ShopFilterState;
    /** Server-resolved localized names for region IDs already in the applied
     *  filter, used for chip labels. Regions added in-session are labeled from
     *  the cascade itself. */
    regionLabels?: Record<string, RegionDisplayLabel>;
    /**
     * Whether the "near me" radius filter applies on this surface.
     *
     * Discover owns its own origin and radius (`longitude`/`latitude`/`radius`,
     * which also drive metro routing), so a second geo constraint there would
     * silently disagree with the page's own. Set false to hide the control and
     * drop `geo` from the state rather than offering a filter that does nothing.
     */
    allowGeo?: boolean;
    /** Bindable panel visibility. */
    open?: boolean;
    /**
     * Receives the sanitized applied state plus the localized region chains the
     * cascade produced for regions added this session, keyed by region ID.
     * Hosts that re-resolve labels server-side (shops, discover) can ignore the
     * chains; client-side hosts (globe) fold them into their region index so a
     * re-opened panel and the sidebar never fall back to raw IDs.
     */
    onapply: (state: ShopFilterState, regionChains: Record<string, AddressRegionEntry[]>) => void;
    onclose: () => void;
  }

  let {
    applied,
    regionLabels = {},
    allowGeo = true,
    open = $bindable(false),
    onapply,
    onclose
  }: Props = $props();

  // ---- Draft state (seeded from `applied` each time the panel opens) ----

  /**
   * `applied`, minus anything this surface cannot honour. Geo is dropped where
   * the page owns its own radius, so a shared link that carries it cannot make
   * the panel claim a filter the server is ignoring.
   */
  const supportedState = (state: ShopFilterState): ShopFilterState =>
    allowGeo ? state : withoutGeoFilter(state);

  let draft = $state<ShopFilterState>(emptyShopFilterState());

  // ── Region ──
  let cascadeIds = $state<string[]>([]);
  let cascadeLabels = $state<string[]>([]);
  /** Bumped to clear the cascade back to the top level after an add/reset. */
  let cascadeResetKey = $state(0);
  /** Localized chains (from the cascade) for regions added in this session;
   *  the server only knows about regions already present in the applied (URL)
   *  filter. Chips label from these, and apply hands them to the host. */
  let regionChains = $state<Record<string, AddressRegionEntry[]>>({});

  const resetCascade = () => {
    cascadeIds = [];
    cascadeLabels = [];
    cascadeResetKey += 1;
  };

  // Any node in the chain may be added — not just the leaf — so a broader area
  // (e.g. a country or province) can be filtered on directly.
  const addRegion = () => {
    const regionId = cascadeIds[cascadeIds.length - 1];
    if (!regionId) return;
    const regions = draft.regions ?? [];
    if (regions.length >= SHOP_FILTER_MAX_REGIONS || regions.includes(regionId)) return;

    regionChains[regionId] = cascadeIds.map((id, i) => ({ id, name: cascadeLabels[i] ?? id }));
    draft.regions = [...regions, regionId];
    resetCascade();
  };

  const removeRegion = (regionId: string) => {
    const regions = (draft.regions ?? []).filter((id) => id !== regionId);
    if (regions.length > 0) draft.regions = regions;
    else delete draft.regions;
    delete regionChains[regionId];
  };

  /** Chip label for a region: the in-session chain, else server-resolved, else the raw ID. */
  const regionLabelFor = (regionId: string): RegionDisplayLabel | undefined => {
    const chain = regionChains[regionId];
    if (chain) return regionLabelFromChain(chain, chain.length - 1, getLocale());
    return regionLabels[regionId];
  };

  // ── Geo ──
  let locating = $state(false);

  const toggleGeo = (enabled: boolean) => {
    if (!enabled) {
      delete draft.geo;
      return;
    }
    locating = true;
    getMyLocation()
      .then(({ latitude, longitude }) => {
        draft.geo = {
          mode: 'near',
          lat: latitude,
          lng: longitude,
          radiusKm: draft.geo?.radiusKm ?? 10
        };
      })
      .catch(() => toastError(m.filter_error_location()))
      .finally(() => (locating = false));
  };

  const setGeoRadius = (radiusKm: number) => {
    if (draft.geo) draft.geo.radiusKm = radiusKm;
  };

  // ── Games ──

  const addRootRequirement = () => {
    draft.games = { op: 'or', children: [{ titleIds: [] }] };
  };

  const addGameChild = (group: ShopFilterGameExpr) => {
    group.children.push({ titleIds: [] });
  };

  const addGameGroup = (group: ShopFilterGameExpr) => {
    group.children.push({ op: 'or', children: [{ titleIds: [] }] });
  };

  const removeChild = (parent: ShopFilterGameExpr | null, index: number) => {
    if (parent) parent.children.splice(index, 1);
    else draft.games = undefined;
  };

  const setLeafTitle = (leaf: ShopFilterGameLeaf, raw: string) => {
    if (raw === '') delete leaf.titleIds;
    else leaf.titleIds = [Number(raw)];
  };

  // ── Numeric ranges ──
  //
  // Every numeric field in the panel is a `{ min?, max? }` range. One helper
  // keeps the "drop the key once empty" bookkeeping in a single place and
  // keeps the bounds ordered, because the schema rejects `min > max` and a
  // rejected field would cost the user the entire filter.

  type RangeBound = 'min' | 'max';
  type Range = { min?: number; max?: number };

  /** Returns `undefined` once the range is empty, so callers drop the key. */
  const withBound = (
    range: Range | undefined,
    bound: RangeBound,
    raw: string
  ): Range | undefined => {
    const next: Range = { ...range };
    const value = raw === '' ? undefined : Math.max(0, Math.floor(Number(raw)));
    if (value === undefined) delete next[bound];
    else next[bound] = value;
    // Dragging one bound past the other nudges it along instead of producing an
    // unsatisfiable range.
    if (next.min !== undefined && next.max !== undefined && next.min > next.max) {
      if (bound === 'min') next.max = next.min;
      else next.min = next.max;
    }
    return next.min === undefined && next.max === undefined ? undefined : next;
  };

  const setMachinesRange = (
    key: 'machineCount' | 'distinctTitles',
    bound: RangeBound,
    raw: string
  ) => {
    const machines = { ...(draft.machines ?? {}) };
    const range = withBound(machines[key], bound, raw);
    if (range) machines[key] = range;
    else delete machines[key];
    if (Object.keys(machines).length === 0) delete draft.machines;
    else draft.machines = machines;
  };

  const setAttendanceRange = (bound: RangeBound, raw: string) => {
    const activity = { ...(draft.activity ?? {}) };
    const range = withBound(activity.attendance, bound, raw);
    if (range) activity.attendance = range;
    else delete activity.attendance;
    if (Object.keys(activity).length === 0) delete draft.activity;
    else draft.activity = activity;
  };

  const setLeafQuantity = (leaf: ShopFilterGameLeaf, bound: RangeBound, raw: string) => {
    const range = withBound(leaf.quantity, bound, raw);
    if (range) leaf.quantity = range;
    else delete leaf.quantity;
  };

  const setGameAttendance = (
    row: { titleIds: number[]; min?: number; max?: number },
    bound: RangeBound,
    raw: string
  ) => {
    const range = withBound(row, bound, raw);
    if (!range) {
      delete row.min;
      delete row.max;
      return;
    }
    if (range.min === undefined) delete row.min;
    else row.min = range.min;
    if (range.max === undefined) delete row.max;
    else row.max = range.max;
  };

  // ── Hours ──

  type ScheduleKey = 'openAt' | 'opensBy' | 'closesFrom';
  const SCHEDULE_KEYS: ScheduleKey[] = ['openAt', 'opensBy', 'closesFrom'];
  const SCHEDULE_LABELS: Record<ScheduleKey, () => string> = {
    openAt: () => m.filter_schedule_openAt(),
    opensBy: () => m.filter_schedule_opensBy(),
    closesFrom: () => m.filter_schedule_closesFrom()
  };
  const SCHEDULE_DEFAULT_MINUTE: Record<ScheduleKey, number> = {
    openAt: 20 * 60,
    opensBy: 10 * 60,
    closesFrom: 22 * 60
  };
  const SCHEDULE_MAX_HOUR: Record<ScheduleKey, number> = {
    openAt: 29,
    opensBy: 23,
    closesFrom: 29
  };

  const setScheduleHour = (key: ScheduleKey, hour: number) => {
    const row = draft.hours?.[key];
    if (row) row.minute = hour * 60 + (row.minute % 60);
  };

  const setScheduleMinute = (key: ScheduleKey, minute: number) => {
    const row = draft.hours?.[key];
    if (row) row.minute = Math.floor(row.minute / 60) * 60 + minute;
  };

  // One shared day picker feeds every enabled schedule row.
  let uiDays = $state<number[]>([]);
  let uiQuantifier = $state<'any' | 'all'>('any');
  /**
   * Whether the user has engaged with the day picker or enabled a schedule row.
   * A schedule row with an empty `days.set` is invalid and gets dropped on
   * serialization, so the picker hint is only useful once they have — but showing
   * it on a freshly opened panel is just noise.
   */
  let uiDaysEngaged = $state(false);

  const DAY_LABELS = () => [
    m.monday(),
    m.tuesday(),
    m.wednesday(),
    m.thursday(),
    m.friday(),
    m.saturday(),
    m.sunday()
  ];

  const toggleUiDay = (day: number) => {
    uiDaysEngaged = true;
    uiDays = uiDays.includes(day) ? uiDays.filter((d) => d !== day) : [...uiDays, day].sort();
  };

  // The picker writes straight into every enabled row. The draft is read and
  // written inside untrack() so this effect depends only on the picker state —
  // tracking the draft here would make the write re-trigger the effect
  // (effect_update_depth_exceeded).
  $effect(() => {
    const set = [...uiDays];
    const quantifier = uiQuantifier;
    untrack(() => {
      if (!draft.hours) return;
      for (const key of SCHEDULE_KEYS) {
        const row = draft.hours[key];
        if (!row) continue;
        const sameSet =
          row.days.set.length === set.length && row.days.set.every((d, i) => d === set[i]);
        if (sameSet && row.days.quantifier === quantifier) continue;
        row.days = { set, quantifier };
      }
    });
  });

  const setHoursFlag = (key: 'openNow' | 'is24h', enabled: boolean) => {
    if (!enabled && draft.hours) {
      delete draft.hours[key];
      if (Object.keys(draft.hours).length === 0) delete draft.hours;
    } else if (enabled) {
      draft.hours = { ...(draft.hours ?? {}), [key]: true };
    }
  };

  const toggleScheduleRow = (key: ScheduleKey, enabled: boolean) => {
    if (!enabled) {
      if (draft.hours) {
        delete draft.hours[key];
        if (Object.keys(draft.hours).length === 0) delete draft.hours;
      }
      return;
    }
    // Enabling a row makes the shared day selection load-bearing from here on.
    uiDaysEngaged = true;
    draft.hours = {
      ...(draft.hours ?? {}),
      [key]: {
        days: { set: [...uiDays], quantifier: uiQuantifier },
        minute: SCHEDULE_DEFAULT_MINUTE[key]
      }
    };
  };

  const setWeekly = (key: 'minOpenDays' | 'minOpenMinutes', raw: string) => {
    if (!draft.hours) return;
    const weekly = { ...(draft.hours.weekly ?? {}) };
    if (raw === '') delete weekly[key];
    else weekly[key] = Math.max(1, Math.floor(Number(raw)));
    if (weekly.minOpenDays === undefined && weekly.minOpenMinutes === undefined) {
      delete draft.hours.weekly;
    } else {
      draft.hours.weekly = weekly;
    }
  };

  const hourOptions = (maxHour: number) => Array.from({ length: maxHour + 1 }, (_, i) => i);
  const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

  // ── Activity ──

  const addGameAttendance = () => {
    draft.activity = {
      ...(draft.activity ?? {}),
      gameAttendance: [
        ...(draft.activity?.gameAttendance ?? []),
        { titleIds: [GAME_TITLES[0]?.id ?? 0], min: 1 }
      ]
    };
  };

  const removeGameAttendance = (index: number) => {
    const rows = (draft.activity?.gameAttendance ?? []).filter((_, i) => i !== index);
    if (rows.length > 0 && draft.activity) draft.activity.gameAttendance = rows;
    else if (draft.activity) delete draft.activity.gameAttendance;
  };

  // ── Advanced ──

  const setDateString = (
    key: 'createdAfter' | 'createdBefore' | 'updatedAfter' | 'updatedBefore',
    raw: string,
    endOfDay = false
  ) => {
    if (!draft.advanced) draft.advanced = {};
    if (raw === '') delete draft.advanced[key];
    else draft.advanced[key] = `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  };

  const dateString = (value: string | undefined) => value?.slice(0, 10) ?? '';

  // ── Apply / reset ──

  const handleApply = () => {
    // Applying also commits the current selection without requiring an extra add click.
    addRegion();
    const state = sanitizeShopFilterState(supportedState($state.snapshot(draft)));
    // Hand the host the chains of exactly the regions that survived
    // sanitization — dropped regions need no labels anywhere.
    const snapshot = $state.snapshot(regionChains);
    const appliedChains: Record<string, AddressRegionEntry[]> = {};
    for (const regionId of state.regions ?? []) {
      if (snapshot[regionId]) appliedChains[regionId] = snapshot[regionId];
    }
    onapply(state, appliedChains);
  };

  const handleReset = () => {
    draft = emptyShopFilterState();
    uiDays = [];
    uiQuantifier = 'any';
    uiDaysEngaged = false;
    regionChains = {};
    resetCascade();
  };

  // Seed the draft + shared pickers from the applied filter on open.
  // Everything is derived from the `seed` snapshot and written inside
  // untrack(): reading the just-written `draft` here (or tracking these
  // writes) would make this effect re-trigger itself and ping-pong with the
  // picker-sync effect (effect_update_depth_exceeded).
  $effect(() => {
    if (!open) return;
    const seed = $state.snapshot(applied);
    const next: ShopFilterState = seed
      ? structuredClone(supportedState(seed))
      : emptyShopFilterState();
    const firstSchedule = next.hours?.openAt ?? next.hours?.opensBy ?? next.hours?.closesFrom;
    const nextDays = firstSchedule ? [...firstSchedule.days.set] : [];
    const nextQuantifier = firstSchedule?.days.quantifier ?? 'any';
    untrack(() => {
      draft = next;
      uiDays = nextDays;
      uiQuantifier = nextQuantifier;
      // A re-opened panel starts clean; the hint belongs to live interaction.
      uiDaysEngaged = false;
      regionChains = {};
      resetCascade();
    });
  });

  const activeCount = $derived(countActiveFilters(draft));
</script>

<div class="modal" class:modal-open={open}>
  <div class="modal-box max-w-4xl">
    <div class="mb-4 flex items-center gap-2">
      <h3 class="flex-1 text-lg font-bold">{m.filter_title()}</h3>
      {#if activeCount > 0}
        <span class="badge badge-primary badge-soft badge-sm"
          >{m.filter_active_count({ count: activeCount })}</span
        >
      {/if}
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-sm"
        onclick={onclose}
        aria-label={m.close_modal()}
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <div class="max-h-[70vh] overflow-y-auto pr-1">
      <div class="grid gap-3 sm:grid-cols-2">
        <!-- Location -->
        <FilterSectionCard icon="fa-location-dot" title={m.filter_section_location()} span>
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <RegionCascadeSelect
                bind:regionIds={cascadeIds}
                bind:selectedLabels={cascadeLabels}
                resetKey={cascadeResetKey}
                gridClass="grid grid-cols-1 gap-2"
              />
            </div>
            <button
              type="button"
              class="btn btn-soft shrink-0"
              disabled={cascadeIds.length === 0 ||
                (draft.regions?.length ?? 0) >= SHOP_FILTER_MAX_REGIONS}
              onclick={addRegion}
            >
              <i class="fa-solid fa-plus"></i>
              {m.filter_add_region()}
            </button>
          </div>

          {#if (draft.regions?.length ?? 0) > 0}
            <div class="flex flex-wrap gap-1">
              {#each draft.regions ?? [] as regionId (regionId)}
                {@const label = regionLabelFor(regionId)}
                <span class="badge badge-soft badge-sm max-w-full gap-1">
                  <i class="fa-solid fa-earth-asia text-[0.6rem] opacity-60"></i>
                  <span class="truncate">{label?.name ?? regionId}</span>
                  {#if label?.path}
                    <span class="truncate opacity-50">{label.path}</span>
                  {/if}
                  <button
                    type="button"
                    class="cursor-pointer opacity-60 hover:opacity-100"
                    onclick={() => removeRegion(regionId)}
                    aria-label={m.filter_remove()}
                  >
                    <i class="fa-solid fa-xmark text-xs"></i>
                  </button>
                </span>
              {/each}
            </div>
          {/if}

          {#if allowGeo}
            <div
              class="border-base-content/10 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
            >
              <label class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  class="toggle toggle-sm"
                  checked={!!draft.geo}
                  onchange={(e) => toggleGeo((e.target as HTMLInputElement).checked)}
                />
                <span class="text-sm font-medium">{m.filter_near_me()}</span>
              </label>
              {#if draft.geo}
                {#if locating}
                  <span class="loading loading-spinner loading-xs"></span>
                {/if}
                <label class="flex items-center gap-2 text-sm">
                  <span class="text-base-content/60">{m.filter_radius()}</span>
                  <select
                    class="select select-bordered select-sm w-24"
                    value={draft.geo.radiusKm}
                    onchange={(e) => setGeoRadius(Number((e.target as HTMLSelectElement).value))}
                  >
                    {#each RADIUS_OPTIONS as radius (radius)}
                      <option value={radius}>{m.filter_radius_option({ radius })}</option>
                    {/each}
                  </select>
                </label>
              {/if}
            </div>
          {/if}
        </FilterSectionCard>

        <!-- Games -->
        <FilterSectionCard icon="fa-gamepad" title={m.filter_section_games()} span>
          {#if draft.games}
            <p class="text-base-content/60 -mt-1 text-xs">{m.filter_section_games_hint()}</p>
            {@render gameNode(draft.games, null, 0, 1)}
          {:else}
            <button
              type="button"
              class="btn btn-ghost btn-sm border-base-content/20 justify-start gap-2 rounded-lg border border-dashed"
              onclick={addRootRequirement}
            >
              <i class="fa-solid fa-plus"></i>
              {m.filter_add_requirement()}
            </button>
          {/if}
        </FilterSectionCard>

        <!-- Machines -->
        <FilterSectionCard icon="fa-desktop" title={m.filter_section_machines()}>
          <div class="flex flex-col gap-3">
            {@render rangeInputs({
              label: m.filter_total_machines(),
              min: draft.machines?.machineCount?.min,
              max: draft.machines?.machineCount?.max,
              onchange: (bound, raw) => setMachinesRange('machineCount', bound, raw)
            })}
            {@render rangeInputs({
              label: m.filter_distinct_titles(),
              min: draft.machines?.distinctTitles?.min,
              max: draft.machines?.distinctTitles?.max,
              onchange: (bound, raw) => setMachinesRange('distinctTitles', bound, raw)
            })}
          </div>
        </FilterSectionCard>

        <!-- Activity -->
        <FilterSectionCard icon="fa-user" title={m.filter_section_activity()}>
          <div class="flex flex-col gap-3">
            {@render rangeInputs({
              label: m.filter_current_attendance(),
              min: draft.activity?.attendance?.min,
              max: draft.activity?.attendance?.max,
              onchange: (bound, raw) => setAttendanceRange(bound, raw)
            })}

            {#each draft.activity?.gameAttendance ?? [] as row, index (index)}
              <div class="bg-base-100/40 flex items-center gap-1.5 rounded-lg px-2 py-1.5">
                <select
                  class="select select-bordered select-sm min-w-0 flex-1"
                  value={row.titleIds[0]}
                  onchange={(e) => (row.titleIds = [Number((e.target as HTMLSelectElement).value)])}
                >
                  {#each GAME_TITLES as game (game.id)}
                    <option value={game.id}>{getGameName(game.key)}</option>
                  {/each}
                </select>
                <div class="w-32 shrink-0">
                  {@render rangeInputs({
                    min: row.min,
                    max: row.max,
                    onchange: (bound, raw) => setGameAttendance(row, bound, raw)
                  })}
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-circle btn-xs shrink-0"
                  onclick={() => removeGameAttendance(index)}
                  aria-label={m.filter_remove()}
                >
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            {/each}

            <button
              type="button"
              class="btn btn-ghost btn-sm gap-2 self-start"
              onclick={addGameAttendance}
            >
              <i class="fa-solid fa-plus"></i>
              {m.filter_add_game_attendance()}
            </button>
          </div>
        </FilterSectionCard>

        <!-- Hours -->
        <FilterSectionCard icon="fa-clock" title={m.filter_section_hours()} span>
          <div
            class="border-base-content/10 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
          >
            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                class="toggle toggle-sm"
                checked={!!draft.hours?.openNow}
                onchange={(e) => setHoursFlag('openNow', (e.target as HTMLInputElement).checked)}
              />
              <span class="text-sm font-medium">{m.filter_open_now()}</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                class="toggle toggle-sm"
                checked={!!draft.hours?.is24h}
                onchange={(e) => setHoursFlag('is24h', (e.target as HTMLInputElement).checked)}
              />
              <span class="text-sm font-medium">{m.filter_open_24h()}</span>
            </label>
          </div>

          <div class="flex flex-col gap-2">
            <span class="text-base-content/60 text-xs font-semibold tracking-wide uppercase">
              {m.filter_days()}
            </span>
            <div class="grid grid-cols-7 gap-1">
              {#each DAY_LABELS() as dayLabel, day (day)}
                <button
                  type="button"
                  class="btn btn-sm px-0 text-xs {uiDays.includes(day)
                    ? 'btn-primary'
                    : 'btn-soft'}"
                  aria-pressed={uiDays.includes(day)}
                  onclick={() => toggleUiDay(day)}
                >
                  {dayLabel.slice(0, 3)}
                </button>
              {/each}
            </div>
            {#if uiDaysEngaged && uiDays.length === 0}
              <p class="text-warning flex items-center gap-1 text-xs">
                <i class="fa-solid fa-triangle-exclamation"></i>
                {m.filter_pick_days_hint()}
              </p>
            {/if}
            <div class="join">
              <button
                type="button"
                class="join-item btn btn-soft btn-sm flex-1 {uiQuantifier === 'any'
                  ? 'btn-primary'
                  : 'btn-soft'}"
                aria-pressed={uiQuantifier === 'any'}
                onclick={() => (uiQuantifier = 'any')}
              >
                {m.filter_days_any()}
              </button>
              <button
                type="button"
                class="join-item btn btn-soft btn-sm flex-1 {uiQuantifier === 'all'
                  ? 'btn-primary'
                  : 'btn-soft'}"
                aria-pressed={uiQuantifier === 'all'}
                onclick={() => (uiQuantifier = 'all')}
              >
                {m.filter_days_all()}
              </button>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="flex flex-col gap-2">
              <span class="text-base-content/60 text-xs font-semibold tracking-wide uppercase">
                {m.filter_schedule_block()}
              </span>
              {#each SCHEDULE_KEYS as key (key)}
                {@const row = draft.hours?.[key]}
                {@const rowLabel = SCHEDULE_LABELS[key]()}
                <div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
                  <label class="flex cursor-pointer items-center gap-2" title={rowLabel}>
                    <input
                      type="checkbox"
                      class="toggle toggle-sm shrink-0"
                      checked={!!row}
                      onchange={(e) =>
                        toggleScheduleRow(key, (e.target as HTMLInputElement).checked)}
                    />
                    <span class="truncate text-sm">{rowLabel}</span>
                  </label>
                  {#if row}
                    <div class="flex items-center gap-1">
                      <select
                        class="select select-bordered select-sm w-16"
                        value={Math.floor(row.minute / 60)}
                        onchange={(e) =>
                          setScheduleHour(key, Number((e.target as HTMLSelectElement).value))}
                      >
                        {#each hourOptions(SCHEDULE_MAX_HOUR[key]) as hour (hour)}
                          <option value={hour}>{String(hour).padStart(2, '0')}</option>
                        {/each}
                      </select>
                      <span class="text-xs opacity-40">:</span>
                      <select
                        class="select select-bordered select-sm w-16"
                        value={row.minute % 60}
                        onchange={(e) =>
                          setScheduleMinute(key, Number((e.target as HTMLSelectElement).value))}
                      >
                        {#each MINUTE_OPTIONS as minute (minute)}
                          <option value={minute}>{String(minute).padStart(2, '0')}</option>
                        {/each}
                      </select>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>

            <div class="flex flex-col gap-2">
              <span class="text-base-content/60 text-xs font-semibold tracking-wide uppercase">
                {m.filter_weekly()}
              </span>
              <label class="flex flex-col gap-1">
                <span class="text-base-content/70 text-xs">{m.filter_min_open_days()}</span>
                <select
                  class="select select-bordered select-sm w-full"
                  value={draft.hours?.weekly?.minOpenDays ?? ''}
                  onchange={(e) => setWeekly('minOpenDays', (e.target as HTMLSelectElement).value)}
                >
                  <option value=""></option>
                  {#each [1, 2, 3, 4, 5, 6, 7] as days (days)}
                    <option value={days}>{days}</option>
                  {/each}
                </select>
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-base-content/70 text-xs">{m.filter_min_open_hours()}</span>
                <input
                  type="number"
                  min="1"
                  max="168"
                  class="input input-bordered input-sm w-full"
                  value={draft.hours?.weekly?.minOpenMinutes
                    ? draft.hours.weekly.minOpenMinutes / 60
                    : ''}
                  onchange={(e) =>
                    setWeekly(
                      'minOpenMinutes',
                      (e.target as HTMLInputElement).value === ''
                        ? ''
                        : String(Number((e.target as HTMLInputElement).value) * 60)
                    )}
                />
              </label>
            </div>
          </div>
        </FilterSectionCard>

        <!-- Advanced -->
        <FilterSectionCard icon="fa-sliders" title={m.filter_section_advanced()} span>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label class="flex flex-col gap-1">
              <span class="text-base-content/70 text-xs">{m.filter_claim()}</span>
              <select
                class="select select-bordered select-sm w-full"
                value={draft.advanced?.claim ?? 'any'}
                onchange={(e) => {
                  const claim = (e.target as HTMLSelectElement).value as
                    'any' | 'claimed' | 'unclaimed';
                  if (claim === 'any') {
                    if (draft.advanced && Object.keys(draft.advanced).length > 0)
                      delete draft.advanced.claim;
                  } else {
                    draft.advanced = { ...(draft.advanced ?? {}), claim };
                  }
                }}
              >
                <option value="any">{m.filter_claim_any()}</option>
                <option value="claimed">{m.filter_claim_claimed()}</option>
                <option value="unclaimed">{m.filter_claim_unclaimed()}</option>
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-base-content/70 text-xs">{m.filter_closed()}</span>
              <select
                class="select select-bordered select-sm w-full"
                value={draft.status?.closed ?? 'include'}
                onchange={(e) => {
                  const closed = (e.target as HTMLSelectElement).value as
                    'include' | 'exclude' | 'only';
                  if (closed === 'include') {
                    if (draft.status && Object.keys(draft.status).length > 0)
                      delete draft.status.closed;
                  } else {
                    draft.status = { ...(draft.status ?? {}), closed };
                  }
                }}
              >
                <option value="include">{m.filter_closed_include()}</option>
                <option value="exclude">{m.filter_closed_exclude()}</option>
                <option value="only">{m.filter_closed_only()}</option>
              </select>
            </label>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1">
              <span class="text-base-content/70 text-xs">{m.filter_created_from()}</span>
              <input
                type="date"
                class="input input-bordered input-sm w-full"
                value={dateString(draft.advanced?.createdAfter)}
                onchange={(e) =>
                  setDateString('createdAfter', (e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-base-content/70 text-xs">{m.filter_created_to()}</span>
              <input
                type="date"
                class="input input-bordered input-sm w-full"
                value={dateString(draft.advanced?.createdBefore)}
                onchange={(e) =>
                  setDateString('createdBefore', (e.target as HTMLInputElement).value, true)}
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-base-content/70 text-xs">{m.filter_updated_from()}</span>
              <input
                type="date"
                class="input input-bordered input-sm w-full"
                value={dateString(draft.advanced?.updatedAfter)}
                onchange={(e) =>
                  setDateString('updatedAfter', (e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-base-content/70 text-xs">{m.filter_updated_to()}</span>
              <input
                type="date"
                class="input input-bordered input-sm w-full"
                value={dateString(draft.advanced?.updatedBefore)}
                onchange={(e) =>
                  setDateString('updatedBefore', (e.target as HTMLInputElement).value, true)}
              />
            </label>
          </div>
        </FilterSectionCard>
      </div>
    </div>

    <div class="modal-action justify-between">
      <button type="button" class="btn btn-soft hover:btn-error" onclick={handleReset}>
        <i class="fa-solid fa-trash"></i>
        {m.clear_filters()}
      </button>
      <button type="button" class="btn btn-primary" onclick={handleApply}>
        <i class="fa-solid fa-check"></i>
        {m.apply_filters()}
      </button>
    </div>
  </div>
  <div
    class="modal-backdrop"
    onclick={onclose}
    onkeydown={(e) => e.key === 'Escape' && onclose()}
    role="button"
    tabindex="0"
    aria-label={m.close_modal()}
  ></div>
</div>

{#snippet rangeInputs(opts: {
  label?: string;
  min: number | undefined;
  max: number | undefined;
  onchange: (bound: 'min' | 'max', raw: string) => void;
})}
  <div class="flex flex-col gap-1">
    {#if opts.label}
      <span class="text-base-content/70 text-xs">{opts.label}</span>
    {/if}
    <div class="flex items-center gap-1">
      <input
        type="number"
        min="0"
        class="input input-bordered input-sm min-w-0 flex-1"
        placeholder={m.filter_min()}
        value={opts.min ?? ''}
        onchange={(e) => opts.onchange('min', (e.target as HTMLInputElement).value)}
      />
      <span class="text-base-content/40 shrink-0 text-xs">–</span>
      <input
        type="number"
        min="0"
        class="input input-bordered input-sm min-w-0 flex-1"
        placeholder={m.filter_max()}
        value={opts.max ?? ''}
        onchange={(e) => opts.onchange('max', (e.target as HTMLInputElement).value)}
      />
    </div>
  </div>
{/snippet}

{#snippet gameNode(
  node: GameChild,
  parent: ShopFilterGameExpr | null,
  index: number,
  depth: number
)}
  {#if 'op' in node}
    <div class="border-primary/30 bg-base-100/40 rounded-box border-s-2 p-2.5">
      <div class="flex items-center gap-2">
        <select class="select select-bordered select-sm" bind:value={node.op}>
          <option value="or">{m.filter_match_any()}</option>
          <option value="and">{m.filter_match_all()}</option>
        </select>
        {#if parent}
          <button
            type="button"
            class="btn btn-ghost btn-circle btn-xs ml-auto"
            onclick={() => removeChild(parent, index)}
            aria-label={m.filter_remove()}
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        {/if}
      </div>
      <div class="mt-2 flex flex-col gap-1.5">
        {#each node.children as child, i (i)}
          {@render gameNode(child, node, i, depth + 1)}
        {/each}
      </div>
      <div class="mt-2 flex gap-1">
        <button type="button" class="btn btn-ghost btn-xs" onclick={() => addGameChild(node)}>
          <i class="fa-solid fa-plus"></i>
          {m.filter_add_requirement()}
        </button>
        {#if depth < SHOP_FILTER_MAX_DEPTH}
          <button type="button" class="btn btn-ghost btn-xs" onclick={() => addGameGroup(node)}>
            <i class="fa-solid fa-plus"></i>
            {m.filter_add_group()}
          </button>
        {/if}
      </div>
    </div>
  {:else}
    <div class="flex items-center gap-1.5">
      <select
        class="select select-bordered select-sm min-w-0 flex-1"
        value={node.titleIds?.[0] ?? ''}
        onchange={(e) => setLeafTitle(node, (e.target as HTMLSelectElement).value)}
      >
        <option value="">{m.filter_any_title()}</option>
        {#each GAME_TITLES as game (game.id)}
          <option value={game.id}>{getGameName(game.key)}</option>
        {/each}
      </select>
      <div class="w-32 shrink-0">
        {@render rangeInputs({
          min: node.quantity?.min,
          max: node.quantity?.max,
          onchange: (bound, raw) => setLeafQuantity(node, bound, raw)
        })}
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-circle btn-xs shrink-0"
        onclick={() => removeChild(parent, index)}
        aria-label={m.filter_remove()}
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  {/if}
{/snippet}
