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
    delta,
    deltaLabel
  }: {
    label: string;
    value: number;
    icon: string;
    iconBgClass: string;
    iconClass: string;
    trend?: TrendPoint[];
    trendColor?: string;
    delta?: number;
    deltaLabel?: string;
  } = $props();

  const deltaClass = $derived(
    delta === undefined
      ? ''
      : delta > 0
        ? 'text-green-600'
        : delta < 0
          ? 'text-red-600'
          : 'text-base-content/60'
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

  {#if delta !== undefined}
    <div class="mt-3 flex items-center text-sm">
      <span class="font-medium {deltaClass}">{delta > 0 ? '+' : ''}{delta}</span>
      <span class="text-base-content/60 ml-1">
        {m.admin_this_week()}
        {#if deltaLabel}
          ·&nbsp;{deltaLabel}
        {/if}
      </span>
    </div>
  {/if}
</div>
