<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';

  export interface TrendPoint {
    date: string; // YYYY-MM-DD
    value: number;
  }

  let {
    data,
    color = '#2563eb',
    height = 72
  }: {
    data: TrendPoint[];
    color?: string;
    height?: number;
  } = $props();

  const locale = getLocale();
  const width = 300;
  const padY = 8;

  const gradientId = $derived(`trend-fill-${color.replace('#', '')}`);

  const values = $derived(data.map((point) => point.value));
  const min = $derived(values.length > 0 ? Math.min(...values) : 0);
  const max = $derived(values.length > 0 ? Math.max(...values) : 0);
  const rawSpan = $derived(max - min);
  const span = $derived(rawSpan || 1);

  const points = $derived(
    data.map((point, index) => {
      const x = data.length > 1 ? (index / (data.length - 1)) * width : width / 2;
      const norm = rawSpan === 0 ? 0.5 : (point.value - min) / span;
      const y = padY + (1 - norm) * (height - padY * 2);
      return { ...point, x, y };
    })
  );

  const linePath = $derived(
    points
      .map(
        (point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
      )
      .join(' ')
  );

  const areaPath = $derived(
    points.length > 0
      ? `${linePath} L${points[points.length - 1].x.toFixed(2)},${height} L${points[0].x.toFixed(2)},${height} Z`
      : ''
  );

  const dateFormatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const numberFormatter = new Intl.NumberFormat(locale);

  const formatDate = (date: string) => {
    const [year, month, day] = date.split('-').map(Number);
    return dateFormatter.format(new Date(year, month - 1, day));
  };

  let container = $state<HTMLDivElement | null>(null);
  let hoveredIndex = $state<number | null>(null);

  const hoveredPoint = $derived(hoveredIndex !== null ? points[hoveredIndex] : null);

  const tooltipStyle = $derived(
    hoveredIndex !== null
      ? `left: ${data.length > 1 ? ((hoveredIndex / (data.length - 1)) * 100).toFixed(2) : 50}%; transform: translateX(${
          hoveredIndex === 0 ? 0 : hoveredIndex === data.length - 1 ? -100 : -50
        }%);`
      : ''
  );

  const labelIndexes = $derived(
    data.length <= 4
      ? data.map((_, index) => index)
      : [
          0,
          Math.floor((data.length - 1) / 3),
          Math.floor(((data.length - 1) * 2) / 3),
          data.length - 1
        ]
  );

  const gridLines = [0.25, 0.5, 0.75];

  function onPointerMove(event: PointerEvent) {
    if (!container || data.length === 0) return;
    const rect = container.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    const index = Math.round(fraction * (data.length - 1));
    hoveredIndex = Math.max(0, Math.min(data.length - 1, index));
  }

  function onPointerLeave() {
    hoveredIndex = null;
  }
</script>

{#if data.length > 0}
  <div
    bind:this={container}
    class="relative select-none"
    role="img"
    aria-label={m.admin_last_30_days()}
    onpointermove={onPointerMove}
    onpointerleave={onPointerLeave}
  >
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      class="text-base-content/10 w-full"
      style={`height: ${height}px`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color={color} stop-opacity="0.25" />
          <stop offset="100%" stop-color={color} stop-opacity="0.02" />
        </linearGradient>
      </defs>

      {#each gridLines as fraction (fraction)}
        <line
          x1={(fraction * width).toFixed(2)}
          y1={padY}
          x2={(fraction * width).toFixed(2)}
          y2={height}
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="3 3"
          vector-effect="non-scaling-stroke"
        />
      {/each}

      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />

      {#if hoveredPoint}
        <line
          x1={hoveredPoint.x}
          y1={padY}
          x2={hoveredPoint.x}
          y2={height}
          stroke="currentColor"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
      {/if}
    </svg>

    {#if hoveredPoint}
      <div
        class="bg-base-100 border-base-300 pointer-events-none absolute top-0 z-10 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-sm"
        style={tooltipStyle}
      >
        <span class="font-semibold">{numberFormatter.format(hoveredPoint.value)}</span>
        <span class="text-base-content/60 ml-1">{formatDate(hoveredPoint.date)}</span>
      </div>
    {/if}

    <div class="text-base-content/40 mt-1 flex justify-between text-[10px]">
      {#each labelIndexes as index (index)}
        <span>{formatDate(data[index].date)}</span>
      {/each}
    </div>
  </div>
{/if}
