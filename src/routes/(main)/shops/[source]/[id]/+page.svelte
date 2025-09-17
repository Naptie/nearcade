<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import {
    adaptiveNewTab,
    aggregateGames,
    calculateDistance,
    convertCoordinates,
    formatHourLiteral,
    formatShopAddress,
    formatTime,
    getGameName,
    getMyLocation,
    getShopOpeningHours,
    getShopSourceUrl,
    pageTitle,
    sanitizeHTML
  } from '$lib/utils';
  import { ATTENDANCE_RADIUS_KM, GAMES } from '$lib/constants';
  import { getContext } from 'svelte';
  import type { AMapContext } from '$lib/types';
  import AttendanceModal from '$lib/components/AttendanceModal.svelte';
  import { browser } from '$app/environment';
  import type { AttendanceData, AttendanceReport } from '$lib/types';
  import { fromPath } from '$lib/utils/scoped';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { getLocale } from '$lib/paraglide/runtime';
  import { enUS, zhCN } from 'date-fns/locale';
  import FancyButton from '$lib/components/FancyButton.svelte';
  import type { User } from '@auth/sveltekit';
  import AttendanceReportBlame from '$lib/components/AttendanceReportBlame.svelte';
  import { invalidateAll } from '$app/navigation';

  let { data }: { data: PageData } = $props();

  let shop = $derived(data.shop);
  let attendanceData = $state<AttendanceData>([]);
  let attendanceReport = $state<AttendanceReport>([]);
  let showAttendanceModal = $state(false);
  let showReportAttendanceModal = $state(false);
  let selectedGameForReport = $state<{ id: number; name: string; version: string } | null>(null);
  let reportedAttendance = $state<number>(0);
  let reportedAttendances = $state<
    Array<{
      id: number;
      count: number | undefined;
      reportedBy: User | undefined;
      reportedAt: string;
    }>
  >([]);
  let totalAttendance = $state(0);
  let openingHours = $derived(getShopOpeningHours(shop));
  let now = $state(new Date());
  let isShopOpen = $derived.by(() => {
    return openingHours && now >= openingHours.open && now <= openingHours.close;
  });
  let otherShop = $derived.by(() => {
    if (!data.currentAttendance) return false;
    const attendance = data.currentAttendance;
    return attendance.shop.source !== shop.source || attendance.shop.id !== shop.id
      ? attendance
      : false;
  });
  let isLoading = $state(0);

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

  // Location checking for attendance
  let amap: typeof AMap | undefined = $state(getContext<AMapContext>('amap')?.amap);
  let isUserNearShop = $state<boolean | null>(null); // null = checking, true/false = result
  let locationError = $state<string | null>(null);
  let shopComment = $state({ sanitized: false, content: data.shop.comment });

  const getAttendanceData = async () => {
    try {
      const attendanceResponse = await fetch(
        fromPath(`/api/shops/${shop.source}/${shop.id}/attendance`)
      );
      if (attendanceResponse.ok) {
        const result = (await attendanceResponse.json()) as {
          total: number;
          registered: AttendanceData;
          reported: AttendanceReport;
        };
        totalAttendance = result.total || 0;
        attendanceData = result.registered || [];
        attendanceReport = result.reported || [];
        reportedAttendances = shop.games
          .map((g) => {
            const reportedAttendance = getGameReportedAttendance(g.gameId);
            if (!reportedAttendance) return undefined;
            return {
              ...reportedAttendance,
              id: g.gameId,
              count:
                (reportedAttendance.count || 0) +
                attendanceData.filter(
                  (a) =>
                    a.gameId === g.gameId &&
                    new Date(a.attendedAt) > new Date(reportedAttendance.reportedAt)
                ).length
            };
          })
          .filter((r) => r !== undefined) as typeof reportedAttendances;
      }
    } catch (err) {
      console.warn('Failed to load attendance data:', err);
    }
  };

  onMount(() => {
    getAttendanceData();
    sanitizeHTML(shop.comment).then((content) => {
      shopComment = { sanitized: true, content };
    });

    const savedRadius = localStorage.getItem('nearcade-radius');
    if (savedRadius) {
      radius = parseInt(savedRadius);
    }

    Promise.all(
      shop.games.map(async (game) => {
        costs[game.gameId] = await sanitizeHTML(game.cost);
      })
    );

    // Check user location proximity to shop
    checkUserProximity();

    const interval = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(interval);
  });

  const checkUserProximity = async () => {
    try {
      // Get user's current location
      const location = await getMyLocation();

      // Convert coordinates using AMap if available
      let convertedLocation = { ...location };
      if (amap) {
        convertedLocation = await convertCoordinates(convertedLocation, amap);
      }

      // Calculate distance to shop
      const shopCoords = shop.location.coordinates;
      const distance = calculateDistance(
        convertedLocation.latitude,
        convertedLocation.longitude,
        shopCoords[1], // latitude
        shopCoords[0] // longitude
      );

      // Check if within attendance radius
      isUserNearShop = distance <= ATTENDANCE_RADIUS_KM;
    } catch (error) {
      console.warn('Failed to get user location:', error);
      locationError = typeof error === 'string' ? error : m.location_unknown_error();
      isUserNearShop = false;
    }
  };

  const getGameInfo = (titleId: number) => {
    return GAMES.find((g) => g.id === titleId);
  };

  const getGameAttendance = (id: number): number => {
    if (!attendanceData) return 0;
    return attendanceData.filter((attendee) => attendee.gameId === id).length;
  };

  const getGameReportedAttendance = (id: number) => {
    if (!attendanceReport) return undefined;
    // Get the most recent reported attendance for this game
    const attendeesWithReported = attendanceReport.filter(
      (attendee) => attendee.gameId === id && attendee.currentAttendances !== undefined
    );
    if (attendeesWithReported.length === 0) return undefined;

    // Return the most recent reported value
    const mostRecent = attendeesWithReported.reduce((latest, current) =>
      new Date(current.reportedAt) > new Date(latest.reportedAt) ? current : latest
    );
    return {
      count: mostRecent.currentAttendances,
      reportedBy: mostRecent.reporter,
      reportedAt: mostRecent.reportedAt
    };
  };

  const handleAttend = async (games: number[], plannedLeaveAt: Date) => {
    if (!data.user) return;

    isLoading = 1;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.source}/${shop.id}/attendance`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          games: games.map((id) => ({ id })),
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
      isLoading = 0;
    }
  };

  const handleLeave = async () => {
    if (!data.user) return;

    isLoading = 1;
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
      isLoading = 0;
    }
  };

  const handleReportAttendance = async () => {
    if (!data.user || !selectedGameForReport) return;

    isLoading = 2;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.source}/${shop.id}/attendance`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          games: [
            {
              id: selectedGameForReport.id,
              currentAttendances: reportedAttendance
            }
          ]
        })
      });

      if (response.ok) {
        await getAttendanceData();
        showReportAttendanceModal = false;
        selectedGameForReport = null;
        reportedAttendance = 0;
      }
    } catch (err) {
      console.error('Error reporting attendance:', err);
    } finally {
      isLoading = 0;
    }
  };

  const openReportModal = (game: { id: number; name: string; version: string }) => {
    selectedGameForReport = game;
    reportedAttendance = reportedAttendances.find((g) => g.id === game.id)?.count || 0;
    showReportAttendanceModal = true;
  };

  // Refresh attendance data every 30 seconds
  $effect(() => {
    if (!browser) return;

    const interval = setInterval(() => {
      getAttendanceData();
    }, 30000);
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>{pageTitle(shop.name, m.shop_details())}</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
  <div class="md:grid md:grid-cols-5 md:gap-8 lg:grid-cols-3">
    {#snippet attend(klass = 'w-full')}
      {#if userAttendance}
        <button
          class="btn btn-error btn-soft {klass}"
          onclick={() => handleLeave()}
          disabled={isLoading === 1}
        >
          {#if isLoading === 1}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            <i class="fa-solid fa-stop"></i>
          {/if}
          {m.leave()}
        </button>
      {:else}
        <div
          class="tooltip-error {klass}"
          class:tooltip={!isShopOpen || !!otherShop || isUserNearShop === false}
          data-tip={isShopOpen
            ? otherShop
              ? m.attending_other_shop({
                  shopName: otherShop.shop.name,
                  attendedAt: formatTime(otherShop.attendedAt)
                })
              : isUserNearShop === false
                ? locationError || m.not_near_shop()
                : ''
            : m.shop_closed()}
        >
          <button
            class="btn btn-primary w-full"
            onclick={() => (showAttendanceModal = true)}
            disabled={!isShopOpen || !!otherShop || isLoading === 1 || !isUserNearShop}
          >
            <i class="fa-solid fa-play"></i>
            {m.attend()}
          </button>
        </div>
      {/if}
    {/snippet}
    {#snippet header(isMain = true)}
      <!-- Shop Header -->
      <div class="mb-8 {isMain ? 'not-md:hidden' : 'md:hidden'}">
        <div class="mb-4 flex items-center justify-between gap-2">
          <h1 class="text-3xl font-bold">{shop.name}</h1>
          <span class="text-base-content/60 text-right not-md:hidden">
            {shop.source.toUpperCase()} #{shop.id}
          </span>
          {@render attend('max-w-[40vw] min-w-24 tooltip-left md:hidden')}
        </div>

        <div
          class="alert alert-success alert-soft flex flex-col items-start gap-2 text-[1.03125rem] leading-normal"
        >
          <div class="flex items-start gap-2">
            <div class="w-4 text-center">
              <i class="fa-solid fa-location-dot mt-0.75 shrink-0"></i>
            </div>
            <span class="whitespace-pre-line">{formatShopAddress(shop, true)}</span>
          </div>
        </div>

        {#if shopComment.content}
          <div class="text-base-content/80 mt-4">
            <p class="whitespace-pre-line" class:prose={shopComment.sanitized}>
              {#if shopComment.sanitized}
                {@html shopComment.content}
              {:else}
                {shopComment.content}
              {/if}
            </p>
          </div>
        {/if}

        <div class="mt-6 flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <a
              href="{resolve('/(main)/discover')}?longitude={shop.location
                ?.coordinates[0]}&latitude={shop.location
                ?.coordinates[1]}&name={shop.name}&radius={radius}"
              target={adaptiveNewTab()}
              class="btn btn-accent btn-soft"
            >
              <i class="fa-solid fa-map-location-dot"></i>
              {m.explore_nearby()}
            </a>
            {#if data.user}
              {@const isStarred = data.user.starredArcades?.some(
                (a) => a.id === shop.id && a.source === shop.source
              )}
              {@const toggleStar = async () => {
                isLoading = 3;
                try {
                  const formData = new FormData();
                  formData.append('arcadeSource', shop.source);
                  formData.append('arcadeId', shop.id.toString());
                  const response = await fetch(
                    resolve('/(main)/settings/starred-arcades') +
                      (isStarred ? '?/removeArcade' : '?/addArcade'),
                    {
                      method: 'POST',
                      body: formData
                    }
                  );
                  if (response.ok) {
                    await invalidateAll();
                  }
                } catch (err) {
                  console.log('Error starring arcade:', err);
                } finally {
                  isLoading = 0;
                }
              }}
              <button
                class="btn btn-warning btn-soft group"
                class:hover:btn-error={isStarred}
                disabled={isLoading === 3}
                onclick={toggleStar}
              >
                <span class="loading loading-spinner loading-sm" class:hidden={isLoading !== 3}
                ></span>
                <span
                  class:hidden={!isStarred || isLoading === 3}
                  class:not-group-hover:hidden={isStarred}
                >
                  <i class="fa-solid fa-trash"></i>
                </span>
                <span
                  class:group-hover:hidden={isStarred}
                  class:not-group-hover:hidden={!isStarred}
                  class:hidden={isLoading === 3}
                >
                  <i class="fa-solid fa-star"></i>
                </span>
                <span
                  class:hidden={isStarred || isLoading === 3}
                  class:group-hover:hidden={!isStarred}
                >
                  <i class="fa-regular fa-star"></i>
                </span>
                <span
                  class:not-group-hover:hidden={isStarred && isLoading !== 3}
                  class:hidden={!isStarred}
                >
                  {m.unstar()}
                </span>
                <span
                  class:group-hover:hidden={isStarred}
                  class:hidden={isStarred && isLoading === 3}
                >
                  {isStarred ? m.starred() : m.star()}
                </span>
              </button>
            {/if}
          </div>
          <a
            href={getShopSourceUrl(shop)}
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-primary btn-soft"
            title={m.view_on_source({ source: shop.source.toUpperCase() })}
          >
            <i class="fa-solid fa-external-link-alt"></i>
            <span class="hidden sm:block md:hidden lg:block">
              {m.view_on_source({ source: shop.source.toUpperCase() })}
            </span>
          </a>
        </div>
      </div>
    {/snippet}

    {@render header(false)}

    <!-- Sidebar -->
    <div class="order-1 not-md:mb-6 md:col-span-2 lg:col-span-1">
      <div class="sticky top-20 space-y-6">
        <!-- Shop Information -->
        <div class="card bg-base-200">
          <div class="card-body p-6">
            <h3 class="mb-2 text-lg font-semibold">{m.shop_info()}</h3>

            <div class="space-y-2">
              {#if openingHours}
                {@const offset = (() => {
                  const minutes = now.getTimezoneOffset();
                  const sign = minutes <= 0 ? '+' : '-';
                  return `${sign}${formatHourLiteral(Math.abs(minutes / 60))}`;
                })()}
                {@const offsetLocal = (() => {
                  const hours = openingHours.offsetHours;
                  const sign = hours >= 0 ? '+' : '-';
                  return `${sign}${formatHourLiteral(Math.abs(hours))}`;
                })()}
                <div class="group flex items-center justify-between gap-1">
                  <span class="text-base-content/60 truncate group-hover:hidden"
                    >{m.opening_hours()} (UTC{offset})</span
                  >
                  <span
                    class="text-base-content/60 truncate not-group-hover:hidden"
                    title={m.local_time()}>{m.opening_hours()} (UTC{offsetLocal})</span
                  >
                  <span class="text-right font-semibold group-hover:hidden"
                    >{formatTime(openingHours.open)} – {formatTime(openingHours.close)}</span
                  >
                  <span class="text-right font-semibold not-group-hover:hidden"
                    >{openingHours.openLocal} – {openingHours.closeLocal}</span
                  >
                </div>
              {/if}

              <div class="flex items-center justify-between gap-1">
                <span class="text-base-content/60 truncate">{m.data_source()}</span>
                <span class="text-right font-semibold">{shop.source.toUpperCase()}</span>
              </div>

              {#if shop.createdAt}
                <div class="flex items-center justify-between gap-1">
                  <span class="text-base-content/60 truncate">{m.created()}</span>
                  <span class="text-right font-semibold"
                    >{formatDistanceToNow(shop.createdAt, {
                      addSuffix: true,
                      locale: getLocale() === 'en' ? enUS : zhCN
                    })}</span
                  >
                </div>
              {/if}

              <div class="flex items-center justify-between gap-1">
                <span class="text-base-content/60 truncate">{m.updated()}</span>
                <span class="text-right font-semibold"
                  >{formatDistanceToNow(shop.updatedAt, {
                    addSuffix: true,
                    locale: getLocale() === 'en' ? enUS : zhCN
                  })}</span
                >
              </div>
            </div>
          </div>
        </div>

        <!-- Shop Statistics -->
        <div class="card bg-base-200 not-md:hidden">
          <div class="card-body p-6">
            <h3 class="mb-2 text-lg font-semibold">{m.shop_statistics()}</h3>

            <div class="space-y-2">
              <div class="flex items-center justify-between gap-1">
                <span class="text-base-content/60 truncate">{m.total_games()}</span>
                <span class="text-right font-semibold">{shop.games.length}</span>
              </div>

              <div class="flex items-center justify-between gap-1">
                <span class="text-base-content/60 truncate">{m.total_machines()}</span>
                <span class="text-right font-semibold"
                  >{shop.games.reduce((total, game) => total + game.quantity, 0)}</span
                >
              </div>
            </div>
          </div>
        </div>

        <!-- Attendance -->
        <div class="card bg-base-200">
          <div class="card-body p-6">
            <h3 class="mb-4 text-lg font-semibold">{m.attendance()}</h3>

            <div class="py-4 text-center">
              {#if attendanceReport.length > 0}
                {@const reportedAttendance = {
                  reportedBy: attendanceReport[0].reporter,
                  reportedAt: attendanceReport[0].reportedAt
                }}
                <AttendanceReportBlame {reportedAttendance}>
                  <div class="text-accent mb-2 text-3xl font-bold">
                    {totalAttendance}
                  </div>
                </AttendanceReportBlame>
              {:else}
                <div class="text-primary mb-2 text-3xl font-bold">{totalAttendance}</div>
              {/if}
              <div class="text-base-content/60 text-sm">{m.players_currently_playing()}</div>
            </div>

            {#if shop.games.length > 0}
              {@const aggregatedGames = aggregateGames(shop)}
              <div class="space-y-2 text-sm">
                {#each aggregatedGames as game (game.titleId)}
                  {@const gameInfo = getGameInfo(game.titleId)}
                  {@const gameAttendance = shop.games.reduce(
                    (total, g) =>
                      g.titleId === game.titleId ? total + getGameAttendance(g.gameId) : total,
                    0
                  )}
                  {@const reportedAttendance = reportedAttendances
                    .reduce(
                      (acc, cur) => {
                        if (shop.games.find((g) => g.gameId === cur.id)?.titleId === game.titleId) {
                          acc.push(cur);
                        }
                        return acc;
                      },
                      [] as typeof reportedAttendances
                    )
                    .reduce(
                      (mostRecent, current) =>
                        !mostRecent ||
                        new Date(current.reportedAt) > new Date(mostRecent.reportedAt)
                          ? { ...current, count: (current.count || 0) + (mostRecent?.count || 0) }
                          : mostRecent,
                      undefined as (typeof reportedAttendances)[number] | undefined
                    )}
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-base-content/60 truncate">
                      {getGameName(gameInfo?.key)}
                    </span>
                    {#if reportedAttendance}
                      <AttendanceReportBlame {reportedAttendance} class="tooltip-left">
                        <span class="text-accent font-medium">
                          {reportedAttendance.count || 0} / {game.quantity}
                        </span>
                      </AttendanceReportBlame>
                    {:else}
                      <span class="font-medium" class:text-primary={gameAttendance > 0}>
                        {gameAttendance} / {game.quantity}
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Attend button -->
            {#if data.user}
              <div class="border-base-content/10 mt-4 border-t pt-4">
                {@render attend()}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="md:col-span-3 lg:col-span-2">
      {@render header()}

      <!-- Games Section -->
      {#if shop.games.length > 0}
        <div class="flex flex-col gap-4">
          {#each shop.games as game, i (i)}
            {@const gameInfo = getGameInfo(game.titleId)}
            {@const countedAttendance = getGameAttendance(game.gameId)}
            {@const reportedAttendance = reportedAttendances.find((g) => g.id === game.gameId)}
            <div
              class="card bg-base-200 group hover:border-primary border-2 border-current/0 shadow-none transition-all hover:shadow-lg"
            >
              <div class="card-body p-6">
                <div class="flex items-center justify-between gap-2">
                  <h3 class="truncate text-xl font-semibold">
                    {game.name}
                  </h3>
                  <div class="flex items-center gap-1">
                    {#if data.user && isShopOpen && isUserNearShop}
                      <FancyButton
                        callback={() =>
                          openReportModal({
                            id: game.gameId,
                            name: game.name,
                            version: game.version
                          })}
                        class="fa-solid fa-chart-simple"
                        btnCls="hover:btn-neutral btn-soft btn-sm text-sm"
                        text={m.report_current_attendance()}
                      />
                    {/if}
                    <div
                      class="btn btn-neutral btn-active btn-soft btn-sm cursor-default text-base"
                    >
                      ×{game.quantity}
                    </div>
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
                  {#if costs[game.gameId]}
                    <div class="group-hover:text-warning flex items-center gap-2 transition-colors">
                      <i class="fa-solid fa-coins"></i>
                      {@html costs[game.gameId]}
                    </div>
                  {/if}
                  {#if game.comment}
                    <div class="flex items-center gap-2 whitespace-pre-line">
                      <i class="fa-solid fa-circle-info"></i>
                      {game.comment}
                    </div>
                  {/if}
                </div>

                <!-- Attendance Section -->
                <div class="border-base-content/10 mt-4 border-t pt-4">
                  <div class="flex items-center justify-between">
                    <span class="text-base-content/60 text-sm"
                      >{m.current_players()} ({countedAttendance})</span
                    >
                    {#if reportedAttendance !== undefined}
                      <AttendanceReportBlame {reportedAttendance}>
                        <span class="text-accent text-sm font-medium">
                          {m.in_attendance({ count: reportedAttendance?.count || 0 })}
                        </span>
                      </AttendanceReportBlame>
                    {:else}
                      <span class="text-sm font-medium">
                        {m.in_attendance({ count: countedAttendance })}
                      </span>
                    {/if}
                  </div>

                  <!-- Detailed attendance list for this game -->
                  {#if attendanceData}
                    {@const attendees = attendanceData.filter(
                      (attendee) => attendee.gameId === game.gameId
                    )}
                    {#if attendees.length > 0}
                      <div class="border-base-content/10 mt-3">
                        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {#each attendees as attendee (attendee.userId)}
                            <div class="tooltip w-fit">
                              <div class="tooltip-content px-3 whitespace-pre-line">
                                {m.attendance_details({
                                  duration: formatDistanceToNow(attendee.attendedAt, {
                                    locale: getLocale() === 'en' ? enUS : zhCN
                                  }),
                                  leave: formatTime(attendee.plannedLeaveAt)
                                })}
                              </div>
                              <div class="w-fit">
                                <UserAvatar
                                  user={attendee.user || { displayName: attendee.userId }}
                                  size="sm"
                                  showName
                                  target={adaptiveNewTab()}
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
  {now}
  onClose={() => (showAttendanceModal = false)}
  onAttend={handleAttend}
/>

<!-- Report Attendance Modal -->
{#if showReportAttendanceModal && selectedGameForReport}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="mb-4 text-lg font-bold">
        {m.report_current_attendance()}
      </h3>

      <div class="mb-4">
        <p class="text-base-content/70 mb-2 flex items-center gap-2 text-sm">
          <i class="fa-solid fa-gamepad"></i>
          <span
            ><strong>{selectedGameForReport.name}</strong> · {selectedGameForReport.version}</span
          >
        </p>
        <p class="text-base-content/70 mb-4 text-sm">
          {m.report_attendance_description()}
        </p>

        <label class="form-control w-full">
          <div class="label">
            <span class="label-text">{m.current_players()}</span>
          </div>
          <input
            type="number"
            min="0"
            max="50"
            bind:value={reportedAttendance}
            class="input input-bordered w-full"
            placeholder="1"
          />
        </label>
      </div>

      <div class="modal-action">
        <button
          class="btn btn-ghost"
          onclick={() => {
            showReportAttendanceModal = false;
            selectedGameForReport = null;
          }}
          disabled={isLoading === 2}
        >
          {m.cancel()}
        </button>
        <button
          class="btn btn-primary"
          onclick={handleReportAttendance}
          disabled={isLoading === 2 || reportedAttendance < 0}
        >
          {#if isLoading === 2}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          {m.submit()}
        </button>
      </div>
    </div>
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={() => {
        showReportAttendanceModal = false;
        selectedGameForReport = null;
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          showReportAttendanceModal = false;
          selectedGameForReport = null;
        }
      }}
    ></div>
  </div>
{/if}
