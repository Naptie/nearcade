<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { GAMES } from '$lib/constants';
  import { getNextDay6AM } from '$lib/utils';
  import type { Shop, Game } from '$lib/types';

  interface AttendanceModalProps {
    isOpen: boolean;
    shop: Shop;
    onClose: () => void;
    onAttend: (gameId: number, plannedLeaveAt: Date) => Promise<void>;
  }

  let { isOpen, shop, onClose, onAttend }: AttendanceModalProps = $props();

  let selectedGameId = $state<number | null>(null);
  let plannedLeaveAt = $state<string>('');
  let isSubmitting = $state(false);

  const getGameInfo = (gameId: number) => {
    return GAMES.find(g => g.id === gameId);
  };

  const formatDateTime = (date: Date): string => {
    return date.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm format for datetime-local input
  };

  // Set default planned leave time to next day 6am when modal opens
  $effect(() => {
    if (isOpen && !plannedLeaveAt) {
      const nextDay6AM = getNextDay6AM(shop.location);
      plannedLeaveAt = formatDateTime(nextDay6AM);
    }
  });

  // Reset form when modal closes
  $effect(() => {
    if (!isOpen) {
      selectedGameId = null;
      plannedLeaveAt = '';
      isSubmitting = false;
    }
  });

  const handleSubmit = async () => {
    if (!selectedGameId || !plannedLeaveAt) return;

    isSubmitting = true;
    try {
      await onAttend(selectedGameId, new Date(plannedLeaveAt));
      onClose();
    } catch (error) {
      console.error('Failed to attend:', error);
      // TODO: Show error message to user
    } finally {
      isSubmitting = false;
    }
  };

  const getMinDateTime = (): string => {
    return formatDateTime(new Date());
  };

  const getMaxDateTime = (): string => {
    const maxDate = getNextDay6AM(shop.location);
    return formatDateTime(maxDate);
  };
</script>

{#if isOpen}
  <!-- Modal backdrop -->
  <div class="modal modal-open">
    <div class="modal-box max-w-lg">
      <!-- Modal header -->
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-semibold">{m.attend_at_shop({ shopName: shop.name })}</h3>
        <button
          class="btn btn-ghost btn-sm btn-circle"
          onclick={onClose}
        >
          <i class="fa-solid fa-times"></i>
        </button>
      </div>

      <!-- Game selection -->
      <div class="mb-6">
        <label class="label">
          <span class="label-text font-medium">{m.select_game()}</span>
        </label>
        <div class="space-y-2">
          {#each shop.games as game (game.id)}
            {@const gameInfo = getGameInfo(game.id)}
            <label class="label cursor-pointer justify-start gap-3 p-3 rounded-lg border border-base-content/20 hover:bg-base-200 transition-colors">
              <input
                type="radio"
                class="radio radio-primary"
                bind:group={selectedGameId}
                value={game.id}
              />
              <div class="flex-1">
                <div class="font-medium">
                  {#if gameInfo}
                    {gameInfo.key.replace(/_/g, ' ').toUpperCase()}
                  {:else}
                    {m.game_id({ id: game.id })}
                  {/if}
                </div>
                <div class="text-sm text-base-content/60">
                  {game.name} • {game.version} • ×{game.quantity}
                </div>
              </div>
            </label>
          {/each}
        </div>
      </div>

      <!-- Planned leave time -->
      <div class="mb-6">
        <label class="label">
          <span class="label-text font-medium">{m.planned_leave_time()}</span>
          <span class="label-text-alt text-base-content/60">{m.planned_leave_time_help()}</span>
        </label>
        <input
          type="datetime-local"
          class="input input-bordered w-full"
          bind:value={plannedLeaveAt}
          min={getMinDateTime()}
          max={getMaxDateTime()}
        />
      </div>

      <!-- Action buttons -->
      <div class="modal-action">
        <button
          class="btn btn-ghost"
          onclick={onClose}
          disabled={isSubmitting}
        >
          {m.cancel()}
        </button>
        <button
          class="btn btn-primary"
          onclick={handleSubmit}
          disabled={!selectedGameId || !plannedLeaveAt || isSubmitting}
        >
          {#if isSubmitting}
            <span class="loading loading-spinner loading-sm"></span>
            {m.attending()}
          {:else}
            <i class="fa-solid fa-play"></i>
            {m.attend()}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}