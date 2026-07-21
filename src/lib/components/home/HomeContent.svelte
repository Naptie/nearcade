<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { fromPath } from '$lib/utils/scoped';
  import { RANKING_RADIUS_OPTIONS } from '$lib/constants';
  import MiniLeaderboard from '$lib/components/home/MiniLeaderboard.svelte';
  import RecentShopChangelog from '$lib/components/home/RecentShopChangelog.svelte';
  import { fade } from 'svelte/transition';

  type LeaderboardItem = {
    key: string;
    label: string;
    sublabel?: string | null;
    href?: string;
    value: number;
  };

  type RegionApiEntry = {
    id: string;
    name: string;
    parentName: string | null;
    value: number;
  };

  type CampusApiEntry = {
    id: string;
    name: string;
    value: number;
  };

  interface HomeStatsResponse {
    totals: {
      shops: number;
      machines: number;
      users: number;
    };
    region: {
      [level: string]: {
        shops: RegionApiEntry[];
        machines: RegionApiEntry[];
      };
    };
    campus: {
      [radius: string]: {
        shops: CampusApiEntry[];
        machines: CampusApiEntry[];
      };
    };
  }

  let stats = $state<HomeStatsResponse | null>(null);
  let isLoading = $state(true);
  let error = $state<string | null>(null);

  const REGION_LEVEL_LABELS: Record<string, () => string> = {
    country: () => m.home_by_country(),
    province: () => m.home_by_province(),
    city: () => m.home_by_city()
  };

  const regionGroups = $derived.by(
    (): { key: string; label: string; items: LeaderboardItem[] }[] => {
      if (!stats) return [];
      const groups: { key: string; label: string; items: LeaderboardItem[] }[] = [];
      for (const level of ['country', 'province', 'city']) {
        const levelData = stats.region[level];
        if (!levelData) continue;
        const levelLabel = REGION_LEVEL_LABELS[level]();
        for (const sort of ['shops', 'machines'] as const) {
          const entries = levelData[sort] ?? [];
          groups.push({
            key: `${level}-${sort}`,
            label: `${levelLabel} · ${sort === 'shops' ? m.home_ranking_shops() : m.home_ranking_machines()}`,
            items: entries.map((entry) => ({
              key: entry.id,
              label: entry.name,
              sublabel: entry.parentName,
              value: entry.value
            }))
          });
        }
      }
      return groups;
    }
  );

  const campusGroups = $derived.by(
    (): { key: string; label: string; items: LeaderboardItem[] }[] => {
      if (!stats) return [];
      const groups: { key: string; label: string; items: LeaderboardItem[] }[] = [];
      for (const radius of RANKING_RADIUS_OPTIONS) {
        const radiusData = stats.campus[String(radius)];
        if (!radiusData) continue;
        for (const sort of ['shops', 'machines'] as const) {
          const entries = radiusData[sort] ?? [];
          groups.push({
            key: `${radius}-${sort}`,
            label: `${
              sort === 'shops' ? m.home_ranking_shops() : m.home_ranking_machines()
            } · ${m.home_within_radius({ radius })}`,
            items: entries.map((entry) => ({
              key: entry.id,
              label: entry.name,
              href: resolve('/(main)/universities/[id]', {
                id: entry.id.split('_')[0]
              }),
              value: entry.value
            }))
          });
        }
      }
      return groups;
    }
  );

  const loadStats = async () => {
    isLoading = true;
    error = null;
    try {
      const response = await fetch(fromPath('/api/home/stats'));
      if (!response.ok) throw new Error(`Failed to load stats: ${response.status}`);
      stats = (await response.json()) as HomeStatsResponse;
    } catch (err) {
      console.error('Error loading home stats:', err);
      error = err instanceof Error ? err.message : 'Failed to load stats';
    } finally {
      isLoading = false;
    }
  };

  onMount(() => {
    loadStats();
  });
</script>

<div class="bg-base-100 relative z-10">
  <div class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 sm:py-14">
    <!-- Site-wide stats -->
    <section>
      {#if isLoading && !stats}
        <div class="flex items-center justify-center p-8">
          <span class="loading loading-spinner loading-lg"></span>
        </div>
      {:else if error && !stats}
        <div class="alert alert-error">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <span>{error}</span>
          <div>
            <button class="btn btn-sm btn-outline" onclick={() => loadStats()}>
              {m.retry()}
            </button>
          </div>
        </div>
      {:else if stats}
        <div
          class="stats bg-base-200/60 dark:bg-base-200/90 border-base-300 not-md:stats-vertical w-full rounded-xl border shadow-none backdrop-blur-2xl dark:border-neutral-700"
          transition:fade
        >
          <div class="stat">
            <div class="stat-figure text-primary">
              <i class="fas fa-store text-3xl"></i>
            </div>
            <div class="stat-title">{m.total_shops()}</div>
            <div class="stat-value text-primary">{stats.totals.shops.toLocaleString()}</div>
          </div>
          <div class="stat">
            <div class="stat-figure text-secondary">
              <i class="fas fa-desktop text-3xl"></i>
            </div>
            <div class="stat-title">{m.total_machines()}</div>
            <div class="stat-value text-secondary">{stats.totals.machines.toLocaleString()}</div>
          </div>
          <div class="stat">
            <div class="stat-figure text-accent">
              <i class="fas fa-users text-3xl"></i>
            </div>
            <div class="stat-title">{m.home_total_users()}</div>
            <div class="stat-value text-accent">{stats.totals.users.toLocaleString()}</div>
          </div>
        </div>
      {/if}
    </section>

    <!-- Mini leaderboards -->
    {#if stats && (regionGroups.length > 0 || campusGroups.length > 0)}
      <section class="grid grid-cols-1 gap-6 lg:grid-cols-2" transition:fade>
        <MiniLeaderboard
          title={m.region_rankings()}
          groups={regionGroups}
          viewAllHref={resolve('/(main)/rankings/region')}
        />
        <MiniLeaderboard
          title={m.campus_rankings()}
          groups={campusGroups}
          viewAllHref={resolve('/(main)/rankings/campus')}
        />
      </section>
    {/if}

    <!-- Recent shop changelog -->
    <section>
      <RecentShopChangelog />
    </section>
  </div>
</div>
