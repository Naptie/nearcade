<script lang="ts">
  import { enhance } from '$app/forms';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { m } from '$lib/paraglide/messages';
  import type { Game, Location } from '$lib/types';
  import ConfirmationModal from './ConfirmationModal.svelte';

  interface Shop {
    id: number;
    name: string;
    location: Location;
    games: Game[];
  }

  let {
    shop,
    shops,
    radius
  }: {
    shop: Shop;
    shops?: Shop[] | undefined;
    radius: number;
  } = $props();

  let showRemoveConfirm = $state(false);

  const confirmRemoveArcade = () => {
    const form = document.getElementById(`removeArcadeForm-${shop.id}`) as HTMLFormElement;
    if (form) {
      form.requestSubmit();
    }
  };
</script>

<div class="group bg-base-100 flex items-center justify-between rounded-lg p-4">
  <a href="https://map.bemanicn.com/shop/{shop.id}" target="_blank" class="flex-1">
    <h3 class="group-hover:text-accent font-medium transition-colors">{shop.name}</h3>
    {#if shop.games && shop.games.length > 0}
      <div class="mt-1 flex flex-wrap gap-1">
        {#each shop.games.slice(0, 3) as game (game.id)}
          <span class="badge badge-xs badge-soft">
            {game.name || `Game ${game.id}`}
          </span>
        {/each}
        {#if shop.games.length > 3}
          <span class="badge badge-xs badge-soft">
            +{shop.games.length - 3}
          </span>
        {/if}
      </div>
    {/if}
  </a>
  {#if shops !== undefined}
    <form method="POST" action="?/addArcade" use:enhance>
      <input type="hidden" name="arcadeId" value={shop.id} />
      <button
        type="submit"
        class="btn btn-primary btn-soft btn-sm"
        disabled={shops.some((a) => a.id === shop.id)}
      >
        {#if shops.some((a) => a.id === shop.id)}
          <i class="fa-solid fa-check"></i>
          {m.already_added()}
        {:else}
          <i class="fa-solid fa-plus"></i>
          {m.add()}
        {/if}
      </button>
    </form>
  {:else}
    <div class="flex gap-2">
      <a
        href="{base}/discover?longitude={shop.location?.coordinates[0]}&latitude={shop.location
          ?.coordinates[1]}&name={shop.name}&radius={radius}"
        target="_blank"
        class="btn btn-soft btn-circle btn-sm"
        title={m.explore_nearby()}
        aria-label={m.explore_nearby()}
      >
        <i class="fa-solid fa-map-location-dot"></i>
      </a>
      {#if page.url.pathname.startsWith(`${base}/settings/`)}
        <form id="removeArcadeForm-{shop.id}" method="POST" action="?/removeArcade" use:enhance>
          <input type="hidden" name="arcadeId" value={shop.id} />
        </form>
        <button
          type="button"
          class="btn btn-soft btn-circle btn-error btn-sm"
          title={m.remove_arcade()}
          aria-label={m.remove_arcade()}
          onclick={() => {
            showRemoveConfirm = true;
          }}
        >
          <i class="fa-solid fa-trash"></i>
        </button>
      {/if}
    </div>
  {/if}
</div>

<ConfirmationModal
  bind:isOpen={showRemoveConfirm}
  title={m.remove_arcade()}
  message={m.confirm_remove_arcade()}
  onConfirm={confirmRemoveArcade}
  onCancel={() => {}}
/>
