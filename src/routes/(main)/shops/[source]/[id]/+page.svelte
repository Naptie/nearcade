<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { formatShopAddress, formatTime, getGameName, pageTitle, sanitizeHTML } from '$lib/utils';
  import { GAMES, ShopSource } from '$lib/constants';
  import AttendanceModal from '$lib/components/AttendanceModal.svelte';
  import { browser } from '$app/environment';
  import type { AttendanceData } from '$lib/types';
  import { fromPath } from '$lib/utils/scoped';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { getLocale } from '$lib/paraglide/runtime';
  import { enUS, zhCN } from 'date-fns/locale';

  let { data }: { data: PageData } = $props();

  let shop = $derived(data.shop);
  let attendanceData = $state<AttendanceData>([]);
  let showAttendanceModal = $state(false);
  let isLoading = $state(false);

  // Track user's current attendance status
  let userAttendance = $state<boolean>(false);
  let costs: Record<string, string> = $state({});

  // Update user attendance status
  $effect(() => {
    if (data.user && attendanceData) {
      userAttendance = attendanceData.some((attendee) => attendee.userId === data.user?.id);
    }
  });

  let radius = $state(10);

  const getAttendanceData = async () => {
    try {
      const attendanceResponse = await fetch(`/api/shops/${shop.source}/${shop.id}/attendance`);
      if (attendanceResponse.ok) {
        const attendanceResult = (await attendanceResponse.json()) as {
          attendanceData?: AttendanceData;
        };
        attendanceData = attendanceResult.attendanceData || [];
      }
    } catch (err) {
      console.warn('Failed to load attendance data:', err);
    }
  };

  onMount(async () => {
    await getAttendanceData();
    const savedRadius = localStorage.getItem('nearcade-radius');
    if (savedRadius) {
      radius = parseInt(savedRadius);
    }
    for (const game of shop.games) {
      costs[game.id] = await sanitizeHTML(game.cost);
    }
  });

  const getGameInfo = (gameId: number) => {
    return GAMES.find((g) => g.id === gameId);
  };

  const getSourceUrl = (): string => {
    return shop.source === ShopSource.ZIV
      ? `https://zenius-i-vanisher.com/v5.2/arcade.php?id=${shop.id}`
      : `https://map.bemanicn.com/shop/${shop.id}`;
  };

  const getTotalAttendance = (): number => {
    if (!attendanceData) return 0;
    const uniqueIds = new Set<string>();
    attendanceData.forEach((attendee) => {
      if (attendee?.userId && typeof attendee.userId === 'string') {
        uniqueIds.add(attendee.userId);
      }
    });
    return uniqueIds.size;
  };

  const getGameAttendance = (id: number, version: string): number => {
    if (!attendanceData) return 0;
    return attendanceData.filter(
      (attendee) => attendee.game.id === id && attendee.game.version === version
    ).length;
  };

  const handleAttend = async (games: { id: number; version: string }[], plannedLeaveAt: Date) => {
    if (!data.user) return;

    isLoading = true;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.source}/${shop.id}/attendance`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          games,
          plannedLeaveAt: plannedLeaveAt.toISOString()
        })
      });

      if (!response.ok) {
        throw new Error('Failed to attend');
      }

      await getAttendanceData();
    } catch (error) {
      console.error('Error attending:', error);
      // TODO: Show error toast
    } finally {
      isLoading = false;
    }
  };

  const handleLeave = async () => {
    if (!data.user) return;

    isLoading = true;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.source}/${shop.id}/attendance`), {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to leave');
      }

      await getAttendanceData();
    } catch (error) {
      console.error('Error leaving:', error);
      // TODO: Show error toast
    } finally {
      isLoading = false;
    }
  };

  // Refresh attendance data every 30 seconds
  $effect(() => {
    if (!browser) return;

    const interval = setInterval(getAttendanceData, 30000);
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>{pageTitle(shop.name, m.shop_details())}</title>
  <meta name="description" content={`${shop.name} - ${formatShopAddress(shop)}`} />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
  <div class="md:grid md:grid-cols-3 md:gap-8">
    {#snippet header(isMain = true)}
      <!-- Shop Header -->
      <div class="mb-8 {isMain ? 'not-md:hidden' : 'md:hidden'}">
        <div class="mb-2 flex items-center justify-between">
          <h1 class="text-3xl font-bold">{shop.name}</h1>
          <span class="text-base-content/60 text-right">{shop.source.toUpperCase()} #{shop.id}</span
          >
        </div>

        <div class="text-base-content/80 mb-6 flex items-start gap-2 text-lg">
          <i class="fa-solid fa-location-dot text-primary mt-1 shrink-0"></i>
          <span>{formatShopAddress(shop)}</span>
        </div>

        <div class="flex gap-4">
          <a
            href="{resolve('/(main)/discover')}?longitude={shop.location
              ?.coordinates[0]}&latitude={shop.location
              ?.coordinates[1]}&name={shop.name}&radius={radius}"
            target="_blank"
            class="btn btn-accent btn-soft"
          >
            <i class="fa-solid fa-map-location-dot"></i>
            {m.explore_nearby()}
          </a>
          <a
            href={getSourceUrl()}
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-primary btn-soft"
          >
            <i class="fa-solid fa-external-link-alt"></i>
            {m.view_on_source({ source: shop.source.toUpperCase() })}
          </a>
        </div>
      </div>
    {/snippet}

    {@render header(false)}

    <!-- Sidebar -->
    <div class="order-1 not-md:mb-6 md:col-span-1">
      <div class="sticky top-20 space-y-6">
        <!-- Shop Statistics -->
        <div class="card bg-base-200 not-md:hidden">
          <div class="card-body p-6">
            <h3 class="mb-2 text-lg font-semibold">{m.shop_statistics()}</h3>

            <div class="space-y-2">
              <div class="flex items-center justify-between gap-1">
                <span class="text-base-content/60 truncate">{m.total_games()}</span>
                <span class="font-semibold">{shop.games.length}</span>
              </div>

              <div class="flex items-center justify-between gap-1">
                <span class="text-base-content/60 truncate">{m.total_machines()}</span>
                <span class="font-semibold"
                  >{shop.games.reduce((total, game) => total + game.quantity, 0)}</span
                >
              </div>

              <div class="flex items-center justify-between gap-1">
                <span class="text-base-content/60 truncate">{m.data_source()}</span>
                <span class="font-semibold">{shop.source.toUpperCase()}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Real-time Attendance -->
        <div class="card bg-base-200">
          <div class="card-body p-6">
            <h3 class="mb-4 text-lg font-semibold">{m.attendance()}</h3>

            <div class="py-4 text-center">
              <div class="text-primary mb-2 text-3xl font-bold">{getTotalAttendance()}</div>
              <div class="text-base-content/60 text-sm">{m.players_currently_playing()}</div>
            </div>

            {#if shop.games.length > 0}
              {@const aggregatedGames = (() => {
                const map = new Map();
                for (const g of shop.games) {
                  const existing = map.get(g.id);
                  if (existing) {
                    existing.quantity += g.quantity;
                  } else {
                    map.set(g.id, { ...g });
                  }
                }
                return Array.from(map.values());
              })()}
              <div class="space-y-2 text-sm">
                {#each aggregatedGames as game (game.id)}
                  {@const gameInfo = getGameInfo(game.id)}
                  {@const gameAttendance = getGameAttendance(game.id, game.version)}
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-base-content/60 truncate">
                      {getGameName(gameInfo?.key)}
                    </span>
                    <span class="font-medium" class:text-success={gameAttendance > 0}>
                      {gameAttendance} / {game.quantity}
                    </span>
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Quick attend button -->
            {#if data.user}
              <div class="border-base-content/10 mt-4 border-t pt-4">
                {#if userAttendance}
                  <button
                    class="btn btn-error btn-soft w-full"
                    onclick={() => handleLeave()}
                    disabled={isLoading}
                  >
                    {#if isLoading}
                      <span class="loading loading-spinner loading-xs"></span>
                    {:else}
                      <i class="fa-solid fa-stop"></i>
                    {/if}
                    {m.leave()}
                  </button>
                {:else}
                  <button
                    class="btn btn-primary w-full"
                    onclick={() => (showAttendanceModal = true)}
                    disabled={isLoading}
                  >
                    <i class="fa-solid fa-play"></i>
                    {m.attend()}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="md:col-span-2">
      {@render header()}

      <!-- Games Section -->
      {#if shop.games.length > 0}
        <div class="flex flex-col gap-4">
          {#each shop.games as game, i (i)}
            {@const gameInfo = getGameInfo(game.id)}
            <div
              class="card bg-base-200 group hover:border-primary border-2 border-current/0 shadow-none transition-all hover:shadow-lg"
            >
              <div class="card-body p-6">
                <div class="flex items-center justify-between">
                  <h3 class="text-lg font-semibold">
                    {game.name}
                  </h3>
                  <div class="badge badge-primary badge-soft badge-lg">
                    ×{game.quantity}
                  </div>
                </div>

                <div class="space-y-2 text-sm">
                  <div class="group-hover:text-accent flex items-center gap-2 transition-colors">
                    <i class="fa-solid fa-gamepad"></i>
                    {#if game.version}
                      <span>{getGameName(gameInfo?.key)} · {game.version}</span>
                    {:else}
                      <span>{getGameName(gameInfo?.key)}</span>
                    {/if}
                  </div>
                  {#if costs[game.id]}
                    <div class="group-hover:text-warning flex items-center gap-2 transition-colors">
                      <i class="fa-solid fa-coins"></i>
                      {@html costs[game.id]}
                    </div>
                  {/if}
                </div>

                <!-- Attendance Section -->
                <div class="border-base-content/10 mt-4 border-t pt-4">
                  <div class="flex items-center justify-between">
                    <span class="text-base-content/60 text-sm">{m.current_players()}</span>
                    <span class="text-sm font-medium"
                      >{m.in_attendance({ count: getGameAttendance(game.id, game.version) })}</span
                    >
                  </div>

                  <!-- Detailed attendance list for this game -->
                  {#if attendanceData}
                    {@const attendees = attendanceData.filter(
                      (attendee) =>
                        attendee.game.id === game.id && attendee.game.version === game.version
                    )}
                    {#if attendees.length > 0}
                      <div class="border-base-content/10 mt-3">
                        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {#each attendees as attendee (attendee.userId)}
                            <div class="tooltip w-fit">
                              <div class="tooltip-content whitespace-pre-line">
                                {m.attendance_details({
                                  duration: formatDistanceToNow(new Date(attendee.attendedAt), {
                                    locale: getLocale() === 'en' ? enUS : zhCN
                                  }),
                                  leave: formatTime(attendee.plannedLeaveAt)
                                })}
                              </div>
                              <div class="w-fit">
                                <UserAvatar
                                  user={attendee.user!}
                                  size="sm"
                                  showName
                                  target="_blank"
                                />
                              </div>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="py-8 text-center">
          <div class="text-base-content/40 mb-2">
            <i class="fa-solid fa-gamepad text-4xl"></i>
          </div>
          <p class="text-base-content/60">{m.no_games_available()}</p>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Attendance Modal -->
<AttendanceModal
  bind:isOpen={showAttendanceModal}
  {shop}
  onClose={() => (showAttendanceModal = false)}
  onAttend={handleAttend}
/>
