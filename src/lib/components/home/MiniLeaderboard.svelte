<script
  lang="ts"
  generics="T extends { key: string; label: string; sublabel?: string | null; href?: string; value: number }"
>
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { m } from '$lib/paraglide/messages';
  import GrowingBar from '$lib/components/home/GrowingBar.svelte';

  type Group = {
    key: string;
    label: string;
    items: T[];
  };

  interface Props {
    title: string;
    groups: Group[];
    viewAllHref: string;
    rotateIntervalMs?: number;
    getValue?: (item: T) => number;
  }

  let {
    title,
    groups,
    viewAllHref,
    rotateIntervalMs = 10_000,
    getValue = (item: T) => item.value
  }: Props = $props();

  let groupIndex = $state(0);
  const currentGroup = $derived(groups.length > 0 ? groups[groupIndex % groups.length] : null);
  const maxValue = $derived(
    currentGroup ? Math.max(1, ...currentGroup.items.map((item) => getValue(item))) : 1
  );

  let interval: ReturnType<typeof setInterval> | undefined = $state();

  function resetInterval() {
    clearInterval(interval);
    if (groups.length <= 1) return;
    interval = setInterval(() => {
      groupIndex = (groupIndex + 1) % groups.length;
    }, rotateIntervalMs);
  }

  onMount(() => {
    resetInterval();
    return () => clearInterval(interval);
  });
</script>

<div
  class="bg-base-200/60 dark:bg-base-200/90 border-base-300 flex flex-col rounded-xl border p-4 shadow-none backdrop-blur-2xl transition hover:shadow-lg sm:p-5 dark:border-neutral-700 dark:shadow-neutral-700/70"
>
  <div class="mb-3 flex items-center justify-between gap-2">
    <h3 class="truncate text-lg font-bold">{title}</h3>
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a href={viewAllHref} class="btn btn-xs sm:btn-sm shrink-0 text-nowrap">
      {m.home_view_full_ranking()}
      <i class="fa-solid fa-arrow-right fa-xs"></i>
    </a>
  </div>

  {#if currentGroup}
    <div class="mb-2 flex items-center justify-between gap-2">
      <span class="badge badge-soft badge-primary badge-sm">{currentGroup.label}</span>
      {#if groups.length > 1}
        <div class="flex gap-1">
          {#each groups as group, i (group.key)}
            <button
              type="button"
              aria-label={group.label}
              class="h-1.5 rounded-full transition-all duration-300 {i ===
              groupIndex % groups.length
                ? 'bg-primary w-4'
                : 'bg-base-content/20 hover:bg-base-content/40 w-1.5'}"
              onclick={() => {
                groupIndex = i;
                resetInterval();
              }}
            ></button>
          {/each}
        </div>
      {/if}
    </div>

    {#key currentGroup.key}
      <div class="flex flex-col gap-1.5" in:fade={{ duration: 250 }}>
        {#each currentGroup.items as item, index (item.key)}
          {@const value = getValue(item)}
          {@const width = Math.max(4, (value / maxValue) * 100)}
          <div class="flex items-center gap-2 text-sm">
            <span
              class="text-base-content/60 w-5 shrink-0 text-right text-xs font-semibold tabular-nums"
            >
              {index + 1}
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <div class="flex min-w-0 items-baseline gap-1.5">
                  {#if item.href}
                    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
                    <a
                      href={item.href}
                      class="hover:text-accent truncate font-medium transition-colors"
                    >
                      {item.label}
                    </a>
                  {:else}
                    <span class="truncate font-medium">{item.label}</span>
                  {/if}
                  {#if item.sublabel}
                    <span class="text-base-content/50 shrink-0 text-xs">{item.sublabel}</span>
                  {/if}
                </div>
                <span class="shrink-0 text-xs tabular-nums opacity-70">
                  {value.toLocaleString()}
                </span>
              </div>
              <div class="bg-base-content/10 mt-1 h-1.5 overflow-hidden rounded-full">
                <GrowingBar {width} delay={index * 40} />
              </div>
            </div>
          </div>
        {:else}
          <div class="text-base-content/50 py-6 text-center text-sm">
            {m.changelog_no_entries()}
          </div>
        {/each}
      </div>
    {/key}
  {/if}
</div>
