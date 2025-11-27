<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { adaptiveNewTab, formatDateTime, getFnsLocale, getGameName } from '$lib/utils';
  import { formatDistanceToNow } from 'date-fns';
  import { onMount } from 'svelte';
  import UserAvatar from './UserAvatar.svelte';
  import type { ShopSource, GAMES } from '$lib/constants';
  import { fromPath } from '$lib/utils/scoped';

  interface AttendanceReport {
    _id: string;
    shop: { id: number; source: ShopSource };
    games: { gameId: number; name: string; version: string; currentAttendances: number }[];
    comment: string | null;
    reportedBy: string;
    reportedAt: string;
    reporter?: {
      id: string;
      name: string | null;
      displayName?: string | null;
      image: string | null;
    };
  }

  let {
    shopSource,
    shopId,
    gamesList
  }: {
    shopSource: ShopSource;
    shopId: number;
    gamesList: readonly (typeof GAMES)[number][];
  } = $props();

  let reports = $state<AttendanceReport[]>([]);
  let isLoading = $state(false);
  let hasMore = $state(false);
  let page = $state(1);

  const fetchReports = async (pageNum: number) => {
    isLoading = true;
    try {
      const response = await fetch(
        fromPath(`/api/shops/${shopSource}/${shopId}/history?page=${pageNum}&limit=5`)
      );
      if (response.ok) {
        const result = (await response.json()) as {
          data: AttendanceReport[];
          pagination: { hasMore: boolean };
        };
        if (pageNum === 1) {
          reports = result.data;
        } else {
          reports = [...reports, ...result.data];
        }
        hasMore = result.pagination.hasMore;
      }
    } catch (err) {
      console.error('Failed to fetch attendance reports:', err);
    } finally {
      isLoading = false;
    }
  };

  const loadMore = () => {
    page += 1;
    fetchReports(page);
  };

  const getGameTitle = (titleId: number) => {
    const game = gamesList.find((g) => g.id === titleId);
    return game ? getGameName(game.key) : null;
  };

  onMount(() => {
    fetchReports(1);
  });
</script>

<div class="card bg-base-200">
  <div class="card-body p-6">
    <div class="mb-4 flex flex-col gap-px">
      <h3 class="text-lg font-semibold">{m.attendance_reports()}</h3>
      <p class="text-base-content/60 text-sm">{m.attendance_reports_description()}</p>
    </div>

    {#if isLoading && reports.length === 0}
      <div class="flex items-center justify-center py-8">
        <span class="loading loading-spinner loading-md"></span>
      </div>
    {:else if reports.length === 0}
      <div class="text-base-content/60 py-8 text-center">
        <i class="fa-solid fa-history mb-2 text-2xl"></i>
        <p>{m.no_attendance_reports()}</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each reports as report (report._id)}
          <div class="bg-base-100 rounded-lg p-4">
            <div class="mb-2 flex items-start justify-between gap-2">
              <div class="flex items-center gap-2">
                <UserAvatar
                  user={report.reporter || { displayName: report.reportedBy }}
                  size="sm"
                  showName
                  target={adaptiveNewTab()}
                />
              </div>
              <div class="tooltip not-md:tooltip-left" data-tip={formatDateTime(report.reportedAt)}>
                <span class="text-base-content/60 shrink-0 text-xs">
                  {formatDistanceToNow(new Date(report.reportedAt), {
                    addSuffix: true,
                    locale: getFnsLocale(getLocale())
                  })}
                </span>
              </div>
            </div>

            <div class="text-base-content/80 space-y-1 text-sm">
              {#each report.games as game (game.gameId)}
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate">
                    {getGameTitle(game.gameId) || game.name}
                    {#if game.version}
                      <span class="text-base-content/50">({game.version})</span>
                    {/if}
                  </span>
                  <span class="text-base-content shrink-0 font-medium">
                    {m.reported_players({ count: game.currentAttendances })}
                  </span>
                </div>
              {/each}
            </div>

            {#if report.comment}
              <div class="border-base-content/10 mt-2 border-t pt-2">
                <p class="text-base-content/60 text-xs">
                  {report.comment}
                </p>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      {#if hasMore}
        <button class="btn btn-ghost btn-sm mt-4 w-full" onclick={loadMore} disabled={isLoading}>
          {#if isLoading}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          {m.load_more()}
        </button>
      {/if}
    {/if}
  </div>
</div>
