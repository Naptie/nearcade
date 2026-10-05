<script lang="ts">
  interface StatItem {
    label: string;
    value: string | number;
    /** Extra classes on the value, e.g. `text-error` for alerts. */
    class?: string;
  }

  interface Props {
    stats: StatItem[];
    class?: string;
  }

  let { stats, class: className = '' }: Props = $props();
</script>

<div class="stats shadow {className}">
  {#each stats as stat (stat.label)}
    <div class="stat px-4 py-2">
      <div class="stat-title text-xs">{stat.label}</div>
      <div class="stat-value text-xl {stat.class ?? 'text-primary'}">{stat.value}</div>
    </div>
  {/each}
</div>
