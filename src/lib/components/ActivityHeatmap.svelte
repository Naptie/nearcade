<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import ActivityItem from '$lib/components/ActivityItem.svelte';
  import type { Activity, ActivityType } from '$lib/types';
  import { activityTypeSchema } from '$lib/schemas/users';
  import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
  import { addDays, eachMonthOfInterval, format, getYear, startOfDay, subMonths } from 'date-fns';
  import { SITE_FOUNDING_YEAR } from '$lib/constants';

  /**
   * GitHub-style activity graph for a user profile.
   *
   * Day counts come from the heatmap API bucketed in the viewer's timezone;
   * the activity-type filter re-levels cells client-side from `byType` (no
   * refetch), the range filter refetches, and clicking a day loads that day's
   * activities from the (date-range aware) feed API.
   */

  interface Props {
    userId: string;
    canView?: boolean;
  }

  let { userId, canView = true }: Props = $props();

  interface HeatmapDay {
    date: string;
    total: number;
    byType: Partial<Record<ActivityType, number>>;
  }

  interface HeatmapResponse {
    days: HeatmapDay[];
    total: number;
    from: string;
    to: string;
    timezone: string;
  }

  /**
   * User-facing filter groups: the nineteen fine-grained activity types are
   * merged into buckets that mean something to a reader of the graph. The
   * underlying ActivityType set stays the source of truth (the day panel
   * still filters the feed API by exact types).
   */
  const TYPE_GROUPS: { key: string; types: ActivityType[] }[] = [
    { key: 'posts', types: ['post'] },
    {
      key: 'comments',
      types: [
        'comment',
        'reply',
        'shop_comment',
        'shop_reply',
        'shop_delete_request_comment',
        'shop_delete_request_reply'
      ]
    },
    {
      key: 'votes',
      types: [
        'post_vote',
        'comment_vote',
        'shop_comment_vote',
        'shop_delete_request_comment_vote',
        'shop_delete_request_vote'
      ]
    },
    { key: 'changelog', types: ['changelog', 'shop_changelog'] },
    { key: 'organizations', types: ['university_join', 'club_join', 'club_create'] },
    { key: 'arcade', types: ['shop_attendance'] },
    { key: 'reports', types: ['attendance_report'] }
  ];

  const ALL_TYPES: ActivityType[] = activityTypeSchema.options;

  if (import.meta.env.DEV) {
    // Guard: every schema type must appear in exactly one filter group.
    const grouped: Partial<Record<ActivityType, number>> = {};
    for (const group of TYPE_GROUPS) {
      for (const type of group.types) {
        grouped[type] = (grouped[type] ?? 0) + 1;
      }
    }
    for (const type of ALL_TYPES) {
      if (!grouped[type]) console.warn(`ActivityHeatmap: type "${type}" missing from TYPE_GROUPS`);
    }
    for (const [type, count] of Object.entries(grouped)) {
      if (count > 1) console.warn(`ActivityHeatmap: type "${type}" listed in ${count} groups`);
    }
  }

  const groupLabel = (key: string): string =>
    (m as unknown as Record<string, () => string>)[`activity_group_${key}`]?.() ?? key;

  /** Checkbox state for one group: all selected / partial (indeterminate) / none. */
  const groupState = (group: (typeof TYPE_GROUPS)[number]) => {
    const selected = group.types.filter((type) => selectedTypes.has(type)).length;
    return {
      checked: selected === group.types.length,
      indeterminate: selected > 0 && selected < group.types.length
    };
  };

  const LEVEL_THRESHOLDS = [1, 3, 5, 8] as const;

  /**
   * Grid sizing: week columns flex with the card width (aspect-square cells
   * keep their square shape, so the graph grows taller as it grows wider),
   * but a column never shrinks below MIN_CELL px — past that point the
   * wrapper shows a horizontal scrollbar instead of squishing the squares.
   */
  const MIN_CELL = 8.9; // px
  const GUTTER = 24; // px, weekday-label column
  const GAP = 3; // px, uniform grid gap

  /**
   * Range selection: `'12m'` is the rolling past-twelve-months window (the
   * default); a number selects a calendar year. Years run from the site's
   * founding year (see `SITE_FOUNDING_YEAR`) through the present year — the
   * present year runs Jan 1 → today, completed years are full calendar years.
   */
  type RangePreset = '12m' | number;

  let days = $state<Map<string, HeatmapDay>>(new Map());
  let rangeFrom = $state<string>('');
  let rangeTo = $state<string>('');
  let isLoading = $state(true);
  let loadError = $state<string | null>(null);

  // Filters
  let selectedTypes = new SvelteSet<ActivityType>(ALL_TYPES);
  let rangePreset = $state<RangePreset>('12m');

  // Day panel
  let selectedDate = $state<string | null>(null);
  let dayActivities = $state<Activity[]>([]);
  let isLoadingDay = $state(false);
  let dayError = $state<string | null>(null);

  const viewerTimezone = $state(
    // Resolved once on component init; sent to the API so day bucketing matches
    // the viewer's calendar (falls back to UTC when the browser hides it).
    (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      } catch {
        return 'UTC';
      }
    })()
  );

  const monthFormatter = $derived(new Intl.DateTimeFormat(getLocale(), { month: 'short' }));
  const weekdayLabel = (weekday: number) =>
    new Intl.DateTimeFormat(getLocale(), { weekday: 'short' }).format(
      // 2024-01-07 was a Sunday; +n days walks Mon..Sat
      new Date(`2024-01-${String(8 + weekday).padStart(2, '0')}T00:00:00Z`)
    );

  const typeFilterActive = $derived(selectedTypes.size !== ALL_TYPES.length);

  /** Per-day count restricted to the selected activity types. */
  const filteredCountOf = (day: HeatmapDay): number => {
    if (!typeFilterActive) return day.total;
    let sum = 0;
    for (const type of selectedTypes) sum += day.byType[type] ?? 0;
    return sum;
  };

  const levelOf = (count: number) => {
    let level = 0;
    for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
      if (count >= LEVEL_THRESHOLDS[i]) level = i + 1;
    }
    return level;
  };

  const cellClass = (level: number) =>
    [
      'rounded-[3px] transition-colors',
      'bg-base-content/[0.06]',
      level === 1 && 'bg-primary/25',
      level === 2 && 'bg-primary/45',
      level === 3 && 'bg-primary/70',
      level === 4 && 'bg-primary',
      'hover:outline hover:outline-base-content/40'
    ]
      .filter(Boolean)
      .join(' ');

  const tooltipFor = (day: HeatmapDay | undefined, date: string) =>
    m.heatmap_day_tooltip({
      count: day ? filteredCountOf(day) : 0,
      date: formatDateLabel(date)
    });

  const formatDateLabel = (date: string) =>
    new Intl.DateTimeFormat(getLocale(), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(`${date}T00:00:00Z`));

  // ---- Grid construction ----------------------------------------------------
  //
  // Columns are full weeks (Sunday-first, like GitHub). The leading/trailing
  // stubs pad the first/last week so every date maps to exactly one cell; the
  // columns render oldest → newest, left → right.

  interface Cell {
    date: string;
    day?: HeatmapDay;
    level: number;
    future: boolean;
  }

  const weeks = $derived.by<Cell[][]>(() => {
    if (!rangeFrom || !rangeTo) return [];

    const byDate = new Map(days);
    const start = new Date(`${rangeFrom}T00:00:00Z`);
    const end = new Date(`${rangeTo}T00:00:00Z`);

    // Rewind to the Sunday on/before `rangeFrom`.
    const gridStart = addDays(start, -start.getUTCDay());

    const columns: Cell[][] = [];
    let cursor = gridStart;
    const today = startOfDay(new Date());
    while (cursor <= end) {
      const column: Cell[] = [];
      for (let i = 0; i < 7; i++) {
        const date = format(cursor, 'yyyy-MM-dd');
        const beyondRange = cursor < start || cursor > end;
        const day = byDate.get(date);
        column.push({
          date,
          day: beyondRange ? undefined : day,
          level: beyondRange ? -1 : levelOf(day ? filteredCountOf(day) : 0),
          future: cursor > today
        });
        cursor = addDays(cursor, 1);
      }
      columns.push(column);
    }
    return columns;
  });

  const months = $derived.by(() => {
    if (!rangeFrom || !rangeTo) return [];
    const start = new Date(`${rangeFrom}T00:00:00Z`);
    const end = new Date(`${rangeTo}T00:00:00Z`);
    // One entry per month, positioned at its first grid column.
    const firstColumnIndex = (date: Date) => {
      const gridStart = addDays(start, -start.getUTCDay());
      return Math.round((date.getTime() - gridStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    };
    return eachMonthOfInterval({ start, end })
      .filter((monthStart) => {
        const monthEnd = new Date(Date.UTC(getYear(monthStart), monthStart.getUTCMonth() + 1, 0));
        return monthEnd >= start && monthStart <= end;
      })
      .map((monthStart) => ({
        column: Math.max(0, firstColumnIndex(monthStart)),
        label: monthFormatter.format(monthStart)
      }));
  });

  /** Width below which the grid refuses to shrink and starts scrolling. */
  const gridMinWidth = $derived(
    weeks.length > 0
      ? `${GUTTER + 4 + weeks.length * MIN_CELL + (weeks.length - 1) * GAP}px`
      : undefined
  );

  /** CSS grid-template for the week columns: one shared gutter + 1fr weeks. */
  const gridTemplate = $derived(
    weeks.length > 0 ? `${GUTTER}px repeat(${weeks.length}, minmax(0, 1fr))` : undefined
  );

  // ---- Data loading -----------------------------------------------------------

  /** Calendar years selectable in the range dropdown, founding year → present. */
  const rangeYears = $derived.by(() => {
    const presentYear = getYear(new Date());
    const years: number[] = [];
    for (let year = presentYear; year >= SITE_FOUNDING_YEAR; year--) {
      years.push(year);
    }
    return years;
  });

  /** Dropdown entries: the rolling 12-month window first, then calendar years. */
  const rangeOptions = $derived.by(() => [
    { key: '12m', label: m.heatmap_range_12m() },
    ...rangeYears.map((year) => ({ key: String(year), label: String(year) }))
  ]);

  const rangeLabel = $derived(rangePreset === '12m' ? m.heatmap_range_12m() : String(rangePreset));

  const resolveRange = (preset: RangePreset): { from: string; to: string } => {
    const today = startOfDay(new Date());
    if (preset === '12m') {
      // Rolling window — GitHub's "last year" view.
      return { from: format(subMonths(today, 12), 'yyyy-MM-dd'), to: format(today, 'yyyy-MM-dd') };
    }
    if (preset === getYear(today)) {
      // The present year runs Jan 1 → today; the future hasn't happened yet.
      return { from: `${preset}-01-01`, to: format(today, 'yyyy-MM-dd') };
    }
    // A completed calendar year.
    return { from: `${preset}-01-01`, to: `${preset}-12-31` };
  };

  const loadHeatmap = async () => {
    isLoading = true;
    loadError = null;
    try {
      const params = new SvelteURLSearchParams({ timezone: viewerTimezone });
      if (rangeFrom) params.set('from', rangeFrom);
      if (rangeTo) params.set('to', rangeTo);
      const response = await fetch(
        `${resolve('/api/users/[id]/activities/heatmap', { id: userId })}?${params}`
      );
      if (!response.ok) {
        throw new Error(`Failed to load activity heatmap (${response.status})`);
      }
      const result = (await response.json()) as HeatmapResponse;
      days = new Map(result.days.map((day) => [day.date, day]));
      rangeFrom = result.from;
      rangeTo = result.to;
    } catch (err) {
      loadError = err instanceof Error ? err.message : 'Failed to load activity heatmap';
    } finally {
      isLoading = false;
    }
  };

  /** Blur the focused element so the focus-based daisyUI dropdown closes. */
  const closeDropdown = () => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  };

  const applyRange = async (key: string) => {
    rangePreset = key === '12m' ? '12m' : Number(key);
    const range = resolveRange(rangePreset);
    rangeFrom = range.from;
    rangeTo = range.to;
    // The selected day may fall outside the new range — drop the panel.
    closeDayPanel();
    closeDropdown();
    await loadHeatmap();
  };

  const toggleGroup = async (group: (typeof TYPE_GROUPS)[number], checked: boolean) => {
    for (const type of group.types) {
      if (checked) {
        selectedTypes.add(type);
      } else {
        selectedTypes.delete(type);
      }
    }
    if (selectedDate) {
      const date = selectedDate;
      closeDayPanel();
      void openDayPanel(date);
    }
  };

  const selectAllGroups = async () => {
    selectedTypes.clear();
    for (const type of ALL_TYPES) selectedTypes.add(type);
    if (selectedDate) {
      const date = selectedDate;
      closeDayPanel();
      void openDayPanel(date);
    }
  };

  // ---- Day panel ---------------------------------------------------------------

  const openDayPanel = async (date: string) => {
    selectedDate = date;
    isLoadingDay = true;
    dayError = null;
    dayActivities = [];
    try {
      const params = new SvelteURLSearchParams({
        from: date,
        to: date,
        limit: '50',
        timezone: viewerTimezone
      });
      if (typeFilterActive) {
        params.set('types', Array.from(selectedTypes).join(','));
      }
      const response = await fetch(
        `${resolve('/api/users/[id]/activities', { id: userId })}?${params}`
      );
      if (!response.ok) {
        throw new Error(`Failed to load activities (${response.status})`);
      }
      const result = (await response.json()) as { activities: Activity[] };
      dayActivities = result.activities;
    } catch (err) {
      dayError = err instanceof Error ? err.message : 'Failed to load activities';
    } finally {
      isLoadingDay = false;
    }
  };

  const onCellClick = (cell: Cell) => {
    if (cell.day || cell.level >= 0) {
      void openDayPanel(cell.date);
    }
  };

  const closeDayPanel = () => {
    selectedDate = null;
    dayActivities = [];
    dayError = null;
  };

  const dayTotalLabel = $derived(
    selectedDate
      ? m.heatmap_activities_on({
          date: formatDateLabel(selectedDate),
          count: days.get(selectedDate)
            ? filteredCountOf(days.get(selectedDate)!)
            : dayActivities.length
        })
      : ''
  );

  // Initial load
  $effect(() => {
    if (canView && days.size === 0 && isLoading) {
      const range = resolveRange(rangePreset);
      rangeFrom = range.from;
      rangeTo = range.to;
      void loadHeatmap();
    }
  });
</script>

<div class="bg-base-200 rounded-xl p-6">
  <div class="mb-4 flex items-center justify-between gap-3">
    <h3 class="flex min-w-0 items-center gap-2 truncate text-lg font-semibold">
      <i class="fa-solid fa-calendar-days shrink-0"></i>
      <span class="truncate">{m.activity_heatmap()}</span>
    </h3>

    {#if canView}
      <div class="flex shrink-0 items-center gap-2">
        <!-- Activity type filter (grouped buckets) -->
        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn btn-ghost btn-sm whitespace-nowrap">
            <i class="fa-solid fa-filter"></i>
            {#if typeFilterActive}
              {@const selectedGroups = TYPE_GROUPS.filter((group) =>
                group.types.some((type) => selectedTypes.has(type))
              ).length}
              {m.activity_group_filter_n({ count: selectedGroups })}
            {:else}
              {m.heatmap_all_types()}
            {/if}
          </div>
          <div
            tabindex="0"
            role="menu"
            aria-label={m.activity_heatmap()}
            class="dropdown-content bg-base-100 z-30 mt-1 max-h-72 w-60 overflow-y-auto rounded-lg p-2 shadow-xl"
          >
            <button
              class="btn btn-ghost btn-sm mb-1 w-full justify-start"
              class:btn-primary={!typeFilterActive}
              onclick={selectAllGroups}
            >
              {m.heatmap_all_types()}
            </button>
            {#each TYPE_GROUPS as group (group.key)}
              {@const state = groupState(group)}
              <label
                class="label hover:bg-base-200 cursor-pointer justify-start gap-2 rounded-lg px-2 py-1 text-sm transition"
              >
                <input
                  type="checkbox"
                  class="checkbox checkbox-xs checked:checkbox-primary"
                  checked={state.checked}
                  indeterminate={state.indeterminate}
                  onchange={(e) => toggleGroup(group, e.currentTarget.checked)}
                />
                {groupLabel(group.key)}
              </label>
            {/each}
          </div>
        </div>

        <!-- Date range filter -->
        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn btn-ghost btn-sm whitespace-nowrap">
            <i class="fa-solid fa-calendar"></i>
            {rangeLabel}
          </div>
          <div
            tabindex="0"
            role="menu"
            aria-label={m.activity_heatmap()}
            class="dropdown-content bg-base-100 z-30 mt-1 max-h-72 w-44 overflow-y-auto rounded-lg p-2 shadow-xl"
          >
            {#each rangeOptions as option (option.key)}
              <button
                role="menuitem"
                class="btn btn-ghost btn-sm w-full justify-start font-normal"
                class:text-primary={option.key === String(rangePreset)}
                onclick={() => applyRange(option.key)}
              >
                {option.label}
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  {#if !canView}
    <div class="text-base-content/60 py-8 text-center">
      <i class="fa-solid fa-lock mb-2 text-3xl"></i>
      <p>{m.activities_are_private()}</p>
    </div>
  {:else if isLoading}
    <div class="space-y-2 py-2">
      <div class="skeleton h-4 w-48"></div>
      <div class="skeleton h-[112px] w-full max-w-2xl"></div>
      <div class="skeleton h-3 w-32"></div>
    </div>
  {:else if loadError}
    <div class="text-base-content/60 py-8 text-center">
      <i class="fa-solid fa-exclamation-triangle text-error mb-2 text-3xl"></i>
      <p>{loadError}</p>
      <button class="btn btn-sm btn-soft mt-4" onclick={() => void loadHeatmap()}>
        {m.try_again()}
      </button>
    </div>
  {:else}
    <!-- Legend (above grid, GitHub order) -->
    <div class="text-base-content/60 mb-2 flex items-center gap-1 text-xs">
      {m.heatmap_less()}
      {#each [0, 1, 2, 3, 4] as level (level)}
        <span class="{cellClass(level)} inline-block h-[10px] w-[10px]"></span>
      {/each}
      {m.heatmap_more()}
    </div>

    <!--
      Fluid grid: every cell is a grid item — week columns are equal 1fr
      tracks and cells are aspect-square, so the graph stretches to the full
      card width and rows grow with the columns to keep the squares. Grid
      items stretch by default, so the weekday labels track the fluid row
      heights for free. gridMinWidth is the point where 1fr would shrink a
      column below MIN_CELL — past it the wrapper scrolls instead.
    -->
    <div class="overflow-x-auto pb-1">
      <div
        class="grid gap-[3px]"
        style="grid-template-columns: {gridTemplate}; min-width: {gridMinWidth};"
      >
        <!-- Month labels: row 1, spanning the cell columns -->
        <div class="relative col-span-full h-4" style="grid-column: 2 / -1;">
          {#each months as month (month.column)}
            {#if month.column >= 0}
              <span
                class="text-base-content/60 absolute top-0 text-[10px] leading-4 whitespace-nowrap"
                style="left: {(month.column * 100) / weeks.length}%;"
              >
                {month.label}
              </span>
            {/if}
          {/each}
        </div>

        <!-- Weekday labels: column 1, rows 2-8, stretched to row height -->
        {#each [0, 1, 2, 3, 4, 5, 6] as weekday (weekday)}
          <div
            class="text-base-content/60 flex items-center justify-end text-[9px] leading-none"
            style="grid-column: 1; grid-row: {weekday + 2};"
          >
            {#if weekday === 0 || weekday === 2 || weekday === 4}
              {weekdayLabel(weekday)}
            {/if}
          </div>
        {/each}

        <!-- Cells: column = week + 1 (past the gutter), row = weekday + 1 -->
        {#each weeks as week, weekIndex (weekIndex)}
          {#each week as cell, weekday (cell.date)}
            <button
              type="button"
              class="{cellClass(cell.level)} aspect-square w-full {cell.level < 0
                ? 'invisible'
                : ''} {cell.future ? 'opacity-40' : ''}"
              class:cursor-pointer={cell.level >= 0}
              disabled={cell.level < 0}
              style="grid-column: {weekIndex + 2}; grid-row: {weekday + 2};"
              data-tip={tooltipFor(cell.day, cell.date)}
              aria-label={tooltipFor(cell.day, cell.date)}
              onclick={() => onCellClick(cell)}
            ></button>
          {/each}
        {/each}
      </div>
    </div>

    <!-- Day panel -->
    {#if selectedDate}
      <div class="border-base-300 mt-4 border-t pt-4">
        <div class="mb-3 flex items-center justify-between">
          <h4 class="flex items-center gap-2 text-sm font-semibold">
            <i class="fa-solid fa-calendar-day text-base-content/60"></i>
            {dayTotalLabel}
          </h4>
          <button
            class="btn btn-ghost btn-xs btn-circle"
            onclick={closeDayPanel}
            aria-label={m.close()}
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        {#if isLoadingDay}
          <div class="text-base-content/60 py-4 text-center">
            <span class="loading loading-spinner loading-md"></span>
          </div>
        {:else if dayError}
          <div class="text-base-content/60 py-4 text-center text-sm">
            {dayError}
          </div>
        {:else if dayActivities.length > 0}
          <div class="space-y-3">
            {#each dayActivities as activity (activity.id)}
              <ActivityItem {activity} />
            {/each}
          </div>
        {:else}
          <div class="text-base-content/60 py-4 text-center text-sm">
            {m.no_recent_activity()}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>
