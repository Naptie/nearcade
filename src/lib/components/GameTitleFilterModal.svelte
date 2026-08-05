<script lang="ts">
  import { untrack } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import { GAME_TITLES } from '$lib/constants';
  import { getGameName } from '$lib/utils';

  interface Props {
    isOpen?: boolean;
    selectedTitleIds: number[];
    onConfirm?: (ids: number[]) => void;
    title?: string;
  }

  let {
    isOpen = $bindable(false),
    selectedTitleIds,
    onConfirm,
    title = m.filter_by_game_titles()
  }: Props = $props();

  // Draft selection — seeded from the committed selection each time the modal opens.
  // untrack() ensures external changes to selectedTitleIds while open don't clobber
  // the user's in-progress edits.
  let draftIds = $state<number[]>([]);

  $effect(() => {
    if (isOpen) {
      untrack(() => {
        draftIds = [...selectedTitleIds];
      });
    }
  });

  const toggle = (id: number) => {
    draftIds = draftIds.includes(id) ? draftIds.filter((x) => x !== id) : [...draftIds, id];
  };

  const handleClear = () => {
    draftIds = [];
  };

  const handleConfirm = () => {
    onConfirm?.(draftIds);
    isOpen = false;
  };

  const handleCancel = () => {
    isOpen = false;
  };
</script>

<div class="modal" class:modal-open={isOpen}>
  <div class="modal-box max-w-2xl">
    <h3 class="mb-4 text-lg font-bold">{title}</h3>

    <div class="max-h-[60vh] overflow-y-auto pr-1">
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {#each GAME_TITLES as game (game.id)}
          <label class="hover:bg-base-300/50 flex cursor-pointer items-center gap-2 rounded-lg p-2">
            <input
              type="checkbox"
              class="checkbox checkbox-sm checked:checkbox-success hover:checkbox-accent border-2 transition-colors"
              checked={draftIds.includes(game.id)}
              onchange={() => toggle(game.id)}
            />
            <span class="text-sm">{getGameName(game.key)}</span>
          </label>
        {/each}
      </div>
    </div>

    <div class="modal-action justify-between">
      <button
        type="button"
        class="btn btn-soft hover:btn-error"
        onclick={handleClear}
        disabled={draftIds.length === 0}
      >
        <i class="fa-solid fa-trash"></i>
        {m.clear_filters()}
      </button>
      <button type="button" class="btn btn-primary" onclick={handleConfirm}>
        <i class="fa-solid fa-check"></i>
        {m.confirm()}
      </button>
    </div>
  </div>
  <div
    class="modal-backdrop"
    onclick={handleCancel}
    onkeydown={(e) => e.key === 'Escape' && handleCancel()}
    role="button"
    tabindex="0"
    aria-label={m.close_modal()}
  ></div>
</div>
