<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { formatShopAddress, pageTitle } from '$lib/utils';
  import { GAMES, ShopSource } from '$lib/constants';
  import type { Game } from '$lib/types';
  import AttendanceModal from '$lib/components/shops/AttendanceModal.svelte';
  import { browser } from '$app/environment';

  let { data }: { data: PageData } = $props();

  const shop = data.shop;
  let attendanceData = $state(data.attendanceData);
  let showAttendanceModal = $state(false);
  let isLoading = $state(false);

  // Track user's current attendance status
  let userAttendance = $state<Record<number, boolean>>({});

  // Update user attendance status
  $effect(() => {
    if (data.user && attendanceData) {
      const newUserAttendance: Record<number, boolean> = {};
      
      for (const [gameIdStr, attendees] of Object.entries(attendanceData)) {
        const gameId = parseInt(gameIdStr);
        newUserAttendance[gameId] = attendees.some((attendee: any) => 
          attendee.userId === data.user?.id
        );
      }
      
      userAttendance = newUserAttendance;
    }
  });

  const getGameInfo = (gameId: number) => {
    return GAMES.find(g => g.id === gameId);
  };

  const getTotalMachines = (): number => {
    return shop.games.reduce((total, game) => total + game.quantity, 0);
  };

  const getSourceUrl = (): string => {
    return shop.source === ShopSource.ZIV 
      ? `https://zenius-i-vanisher.com/v5.2/arcade.php?id=${shop.id}`
      : `https://map.bemanicn.com/shop/${shop.id}`;
  };

  const getGoogleMapsUrl = (): string => {
    const address = formatShopAddress(shop);
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shop.name} ${address}`)}`;
  };

  const getTotalAttendance = (): number => {
    if (!attendanceData) return 0;
    return Object.values(attendanceData).reduce((total: number, attendees: any[]) => total + attendees.length, 0);
  };

  const getGameAttendance = (gameId: number): number => {
    if (!attendanceData || !attendanceData[gameId]) return 0;
    return attendanceData[gameId].length;
  };

  const handleAttend = async (gameId: number, plannedLeaveAt: Date) => {
    if (!data.user) return;

    isLoading = true;
    try {
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          shopSource: shop.source,
          shopId: shop.id,
          gameId,
          plannedLeaveAt: plannedLeaveAt.toISOString()
        })
      });

      if (!response.ok) {
        throw new Error('Failed to attend');
      }

      // Refresh attendance data
      await refreshAttendanceData();
    } catch (error) {
      console.error('Error attending:', error);
      // TODO: Show error toast
    } finally {
      isLoading = false;
    }
  };

  const handleLeave = async (gameId: number) => {
    if (!data.user) return;

    isLoading = true;
    try {
      const response = await fetch('/api/attendance', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          shopSource: shop.source,
          shopId: shop.id,
          gameId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to leave');
      }

      // Refresh attendance data
      await refreshAttendanceData();
    } catch (error) {
      console.error('Error leaving:', error);
      // TODO: Show error toast
    } finally {
      isLoading = false;
    }
  };

  const refreshAttendanceData = async () => {
    if (!browser) return;

    try {
      const response = await fetch(`/api/attendance?shopSource=${shop.source}&shopId=${shop.id}`);
      if (response.ok) {
        const result = await response.json();
        attendanceData = result.attendanceData || {};
      }
    } catch (error) {
      console.error('Error refreshing attendance:', error);
    }
  };

  // Refresh attendance data every 30 seconds
  $effect(() => {
    if (!browser) return;

    const interval = setInterval(refreshAttendanceData, 30000);
    return () => clearInterval(interval);
  });

  const formatAttendanceTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };
</script>

<svelte:head>
  <title>{pageTitle(shop.name, m.shop_details())}</title>
  <meta name="description" content={`${shop.name} - ${formatShopAddress(shop)}`} />
</svelte:head>

<div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
  <div class="lg:grid lg:grid-cols-3 lg:gap-8">
    <!-- Main Content -->
    <div class="lg:col-span-2">
      <!-- Shop Header -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-4">
          <h1 class="text-3xl font-bold">{shop.name}</h1>
          <div class="flex items-center gap-2">
            <span class="badge badge-outline badge-lg">
              {shop.source.toUpperCase()}
            </span>
            <span class="text-base-content/60">#{shop.id}</span>
          </div>
        </div>

        <div class="text-base-content/80 flex items-start gap-2 text-lg mb-6">
          <i class="fa-solid fa-location-dot mt-1 text-primary shrink-0"></i>
          <span>{formatShopAddress(shop)}</span>
        </div>

        <div class="flex gap-4">
          <a
            href={getSourceUrl()}
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-primary"
          >
            <i class="fa-solid fa-external-link-alt"></i>
            {m.view_on_source({ source: shop.source.toUpperCase() })}
          </a>
          <a
            href={getGoogleMapsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            class="btn btn-secondary"
          >
            <i class="fa-solid fa-map-marker-alt"></i>
            {m.view_on_maps()}
          </a>
        </div>
      </div>

      <!-- Games Section -->
      <div class="mb-8">
        <h2 class="text-2xl font-semibold mb-6">{m.available_games()}</h2>
        
        {#if shop.games.length > 0}
          <div class="grid gap-6 sm:grid-cols-2">
            {#each shop.games as game (game.id)}
              {@const gameInfo = getGameInfo(game.id)}
              <div class="card bg-base-200 border-base-content/20 border">
                <div class="card-body p-6">
                  <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-semibold">
                      {#if gameInfo}
                        {gameInfo.key.replace(/_/g, ' ').toUpperCase()}
                      {:else}
                        {m.game_id({ id: game.id })}
                      {/if}
                    </h3>
                    <div class="badge badge-primary badge-lg">
                      ×{game.quantity}
                    </div>
                  </div>

                  <div class="space-y-2 text-sm">
                    <div class="flex justify-between">
                      <span class="text-base-content/60">{m.game_name()}:</span>
                      <span>{game.name}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-base-content/60">{m.version()}:</span>
                      <span>{game.version}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-base-content/60">{m.cost()}:</span>
                      <span class="text-right break-all">{game.cost}</span>
                    </div>
                  </div>

                  <!-- Attendance Section -->
                  <div class="mt-4 pt-4 border-t border-base-content/10">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm text-base-content/60">{m.current_players()}:</span>
                      <span class="text-sm font-medium">{getGameAttendance(game.id)} {m.online()}</span>
                    </div>
                    
                    {#if data.user}
                      {#if userAttendance[game.id]}
                        <button 
                          class="btn btn-error btn-sm w-full"
                          onclick={() => handleLeave(game.id)}
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
                          class="btn btn-outline btn-sm w-full"
                          onclick={() => showAttendanceModal = true}
                          disabled={isLoading}
                        >
                          <i class="fa-solid fa-play"></i>
                          {m.attend()}
                        </button>
                      {/if}
                    {:else}
                      <div class="text-center text-sm text-base-content/60 py-2">
                        {m.sign_in_to_attend()}
                      </div>
                    {/if}

                    <!-- Detailed attendance list for this game -->
                    {#if attendanceData[game.id] && attendanceData[game.id].length > 0}
                      <div class="mt-3 pt-3 border-t border-base-content/10">
                        <div class="text-xs text-base-content/60 mb-2 font-medium">
                          {m.currently_playing()}:
                        </div>
                        <div class="space-y-1 max-h-24 overflow-y-auto">
                          {#each attendanceData[game.id] as attendee}
                            <div class="flex justify-between items-center text-xs">
                              <span class="truncate">
                                {attendee.userId === data.user?.id ? m.you() : `${m.user()} ${attendee.userId.slice(0, 8)}...`}
                              </span>
                              <span class="text-base-content/60 shrink-0">
                                {formatAttendanceTime(attendee.attendedAt)}
                              </span>
                            </div>
                          {/each}
                        </div>
                      </div>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="text-center py-8">
            <div class="text-base-content/40 mb-2">
              <i class="fa-solid fa-gamepad text-4xl"></i>
            </div>
            <p class="text-base-content/60">{m.no_games_available()}</p>
          </div>
        {/if}
      </div>
    </div>

    <!-- Sidebar -->
    <div class="lg:col-span-1">
      <div class="sticky top-24 space-y-6">
        <!-- Shop Statistics -->
        <div class="card bg-base-200 border-base-content/20 border">
          <div class="card-body p-6">
            <h3 class="text-lg font-semibold mb-4">{m.shop_statistics()}</h3>
            
            <div class="space-y-4">
              <div class="flex justify-between items-center">
                <span class="text-base-content/60">{m.total_machines()}:</span>
                <span class="font-semibold">{getTotalMachines()}</span>
              </div>
              
              <div class="flex justify-between items-center">
                <span class="text-base-content/60">{m.total_games()}:</span>
                <span class="font-semibold">{shop.games.length}</span>
              </div>

              <div class="flex justify-between items-center">
                <span class="text-base-content/60">{m.data_source()}:</span>
                <span class="font-semibold">{shop.source.toUpperCase()}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Real-time Attendance -->
        <div class="card bg-base-200 border-base-content/20 border">
          <div class="card-body p-6">
            <h3 class="text-lg font-semibold mb-4">{m.realtime_attendance()}</h3>
            
            <div class="text-center py-4">
              <div class="text-3xl font-bold text-primary mb-2">{getTotalAttendance()}</div>
              <div class="text-base-content/60 text-sm">{m.players_currently_playing()}</div>
            </div>

            <div class="space-y-2 text-sm">
              {#each shop.games as game (game.id)}
                {@const gameInfo = getGameInfo(game.id)}
                {@const gameAttendance = getGameAttendance(game.id)}
                <div class="flex justify-between items-center">
                  <span class="text-base-content/60 truncate max-w-24">
                    {#if gameInfo}
                      {gameInfo.key.replace(/_/g, ' ')}
                    {:else}
                      Game #{game.id}
                    {/if}
                  </span>
                  <span class="font-medium" class:text-success={gameAttendance > 0}>
                    {gameAttendance} / {game.quantity}
                  </span>
                </div>
              {/each}
            </div>

            <!-- Quick attend button -->
            {#if data.user && shop.games.length === 1}
              {@const singleGame = shop.games[0]}
              <div class="mt-4 pt-4 border-t border-base-content/10">
                {#if userAttendance[singleGame.id]}
                  <button 
                    class="btn btn-error btn-sm w-full"
                    onclick={() => handleLeave(singleGame.id)}
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
                    class="btn btn-primary btn-sm w-full"
                    onclick={() => showAttendanceModal = true}
                    disabled={isLoading}
                  >
                    <i class="fa-solid fa-play"></i>
                    {m.quick_attend()}
                  </button>
                {/if}
              </div>
            {:else if data.user && shop.games.length > 1}
              <div class="mt-4 pt-4 border-t border-base-content/10">
                <button 
                  class="btn btn-primary btn-sm w-full"
                  onclick={() => showAttendanceModal = true}
                  disabled={isLoading}
                >
                  <i class="fa-solid fa-play"></i>
                  {m.attend()}
                </button>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Attendance Modal -->
<AttendanceModal
  bind:isOpen={showAttendanceModal}
  {shop}
  onClose={() => showAttendanceModal = false}
  onAttend={handleAttend}
/>