<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import TrendChart, { type TrendPoint } from './TrendChart.svelte';

  let {
    label,
    value,
    icon,
    iconBgClass,
    iconClass,
    trend,
    trendColor,
    added,
    removed,
    deltaLabel
  }: {
    label: string;
    value: number;
    icon: string;
    iconBgClass: string;
    iconClass: string;
    trend?: TrendPoint[];
    trendColor?: string;
    /** Exact adds over the trailing snapshot period (null = no history yet). */
    added?: number | null;
    /** Exact removes over the trailing snapshot period. */
    removed?: number | null;
    deltaLabel?: string;
  } = $props();

  const hasDelta = $derived((added ?? null) !== null || (removed ?? null) !== null);
  const net = $derived((added ?? 0) - (removed ?? 0));
  const netClass = $derived(
    !hasDelta ? '' : net > 0 ? 'text-green-600' : net < 0 ? 'text-red-600' : 'text-base-content/60'
  );
</script>

<div class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
  <div class="flex items-center justify-between">
    <div class="min-w-0">
      <p class="text-base-content/60 truncate text-sm font-medium">{label}</p>
      <p class="text-base-content text-2xl font-bold">{value}</p>
    </div>
    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full {iconBgClass}">
      <i class="fa-solid {icon} text-lg {iconClass}"></i>
    </div>
  </div>

  {#if trend && trend.length > 1}
    <div class="mt-4">
      <TrendChart data={trend} color={trendColor ?? '#2563eb'} />
    </div>
  {/if}

  {#if hasDelta}
    <div class="mt-3 flex flex-wrap items-center gap-x-2 text-sm">
      <span class="font-medium text-green-600">+{added ?? 0}</span>
      <span class="font-medium text-red-600">−{removed ?? 0}</span>
      <span class="text-base-content/60">
        {m.admin_this_week()}
        {#if net !== 0}
          <span class="ml-1 {netClass}">({net > 0 ? '+' : ''}{net})</span>
        {/if}
        {#if deltaLabel}
          ·&nbsp;{deltaLabel}
        {/if}
      </span>
    </div>
  {/if}
</div>
