<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { GAMES } from '$lib/constants';
  import { formatDateTime, formatTime, getGameName, getShopOpeningHours } from '$lib/utils';
  import type { Shop } from '$lib/types';
  import { onMount } from 'svelte';

  interface AttendanceModalProps {
    isOpen: boolean;
    shop: Shop;
    onClose: () => void;
    onAttend: (games: number[], plannedLeaveAt: Date) => Promise<void>;
  }

  let { isOpen = $bindable(), shop, onClose, onAttend }: AttendanceModalProps = $props();

  const toLocalTime = (date: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      date.getFullYear() +
      '-' +
      pad(date.getMonth() + 1) +
      '-' +
      pad(date.getDate()) +
      'T' +
      pad(date.getHours()) +
      ':' +
      pad(date.getMinutes())
    );
  };

  const getEarliestPlannedLeave = () =>
    new Date(
      Math.min(
        Date.now() + 9 * 60 * 1000,
        Math.max(Date.now(), getShopOpeningHours(shop).close.getTime() - 60 * 1000)
      )
    );

  let selectedGames = $state<number[] | null>(null);
  let plannedLeaveAt = $state<string>('');
  let isSubmitting = $state(false);
  let latestPlannedLeave = $derived(getShopOpeningHours(shop).close);
  let earliestPlannedLeave = $state(getEarliestPlannedLeave());
  let now = $state(new Date());

  const getGameInfo = (gameId: number) => {
    return GAMES.find((g) => g.id === gameId);
  };

  $effect(() => {
    if (isOpen && !plannedLeaveAt) {
      plannedLeaveAt = toLocalTime(
        new Date(Math.min(Date.now() + 30 * 60 * 1000, latestPlannedLeave.getTime() - 60 * 1000))
      );
    }
  });

  $effect(() => {
    if (!isOpen) {
      selectedGames = null;
      plannedLeaveAt = '';
      isSubmitting = false;
    }
  });

  onMount(() => {
    const interval = setInterval(() => {
      now = new Date();
      earliestPlannedLeave = getEarliestPlannedLeave();
    }, 1000);
    return () => clearInterval(interval);
  });

  const handleSubmit = async () => {
    if (!selectedGames || !plannedLeaveAt) return;

    isSubmitting = true;
    try {
      await onAttend(selectedGames, new Date(plannedLeaveAt));
      onClose();
    } catch (error) {
      console.error('Failed to attend:', error);
      // TODO: Show error message to user
    } finally {
      isSubmitting = false;
    }
  };
</script>

{#if isOpen}
  {@const { open, close } = getShopOpeningHours(shop)}
  <!-- Modal backdrop -->
  <div class="modal modal-open">
    <div class="modal-box max-w-lg">
      <!-- Modal header -->
      <div class="mb-6 flex items-start justify-between">
        <h3 class="text-xl font-semibold">{m.attend_at_shop({ shopName: shop.name })}</h3>
        <button class="btn btn-ghost btn-sm btn-circle" onclick={onClose} aria-label={m.close()}>
          <i class="fa-solid fa-times fa-lg"></i>
        </button>
      </div>

      <!-- Game selection -->
      <div class="mb-6">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="label mb-1">
          <span class="label-text font-medium">{m.select_game()}</span>
        </label>
        <div class="flex flex-col gap-2">
          {#each shop.games as game, i (i)}
            {@const gameInfo = getGameInfo(game.titleId)}
            <label
              class="label border-base-content/20 hover:bg-base-200 cursor-pointer justify-start gap-3 rounded-lg border p-3 transition-colors"
            >
              <input
                type="checkbox"
                class="checkbox hover:checkbox-primary checked:checkbox-primary border-2 transition"
                bind:group={selectedGames}
                value={game.gameId}
              />
              <div class="flex-1">
                <div class="text-base-content font-medium">
                  {game.name}
                </div>
                <div class="text-base-content/60 text-sm">
                  {getGameName(gameInfo?.key)} · {game.version} · {m.machines({
                    count: game.quantity
                  })}
                </div>
              </div>
            </label>
          {/each}
        </div>
      </div>

      <!-- Planned leave time -->
      <div class="mb-6">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="label mb-1 flex justify-between">
          <span class="label-text font-medium">{m.planned_leave_time()}</span>
          <span
            class="label-text-alt text-base-content/60 text-right"
            class:text-error={now < open || now > new Date(close.getTime() - 10 * 60 * 1000)}
          >
            {now < open || now > close
              ? m.shop_closed()
              : now > new Date(close.getTime() - 10 * 60 * 1000)
                ? m.shop_closing()
                : m.planned_leave_time_help({
                    time: formatTime(latestPlannedLeave),
                    isTomorrow: (() => {
                      return (
                        latestPlannedLeave.getFullYear() === now.getFullYear() &&
                        latestPlannedLeave.getMonth() === now.getMonth() &&
                        latestPlannedLeave.getDate() === now.getDate() + 1
                      ).toString();
                    })()
                  })}
          </span>
        </label>
        <input
          id="planned-leave-time"
          type="datetime-local"
          class="input input-bordered w-full"
          class:input-error={(plannedLeaveAt &&
            (new Date(plannedLeaveAt) <= earliestPlannedLeave ||
              new Date(plannedLeaveAt) > latestPlannedLeave)) ||
            now < open ||
            now > new Date(close.getTime() - 10 * 60 * 1000)}
          bind:value={plannedLeaveAt}
          min={toLocalTime(earliestPlannedLeave)}
          max={toLocalTime(latestPlannedLeave)}
        />
        {#if plannedLeaveAt}
          {#if new Date(plannedLeaveAt) <= earliestPlannedLeave}
            <p class="text-error mt-1 text-sm">
              {m.no_earlier_than({ time: formatDateTime(earliestPlannedLeave) })}
            </p>
          {:else if new Date(plannedLeaveAt) > latestPlannedLeave}
            <p class="text-error mt-1 text-sm">
              {m.no_later_than({
                time: formatDateTime(latestPlannedLeave)
              })}
            </p>
          {/if}
        {/if}
      </div>

      <!-- Action buttons -->
      <div class="modal-action">
        <button class="btn btn-ghost" onclick={onClose} disabled={isSubmitting}>
          {m.cancel()}
        </button>
        <button
          class="btn btn-primary"
          onclick={handleSubmit}
          disabled={!selectedGames ||
            !plannedLeaveAt ||
            new Date(plannedLeaveAt) <= earliestPlannedLeave ||
            new Date(plannedLeaveAt) > latestPlannedLeave ||
            now < open ||
            now > new Date(close.getTime() - 10 * 60 * 1000) ||
            isSubmitting}
        >
          {#if isSubmitting}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            <i class="fa-solid fa-play"></i>
          {/if}
          {m.attend()}
        </button>
      </div>
    </div>
  </div>
{/if}
