<script lang="ts">
  import { untrack } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import { GAME_TITLES } from '$lib/constants';
  import LocationPickerModal from '$lib/components/LocationPickerModal.svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import RegionCascadeSelect from '$lib/components/RegionCascadeSelect.svelte';
  import { getGameName } from '$lib/utils';
  import type { OpeningHourTime } from '$lib/types';
  import type { GameFormData, ShopFormData } from '$lib/schemas/forms';

  type Props = {
    initialData?: Partial<ShopFormData>;
    onSubmit: (data: ShopFormData) => Promise<void>;
    onCancel: () => void;
    submitLabel?: string;
  };

  let { initialData = {}, onSubmit, onCancel, submitLabel = m.save() }: Props = $props();

  // ---- Form state ----

  let name = $state(untrack(() => initialData.name ?? ''));
  let comment = $state(untrack(() => initialData.comment ?? ''));
  let detailedAddress = $state(untrack(() => initialData.address?.detailed ?? ''));
  let location = $state<ShopFormData['location'] | null>(
    untrack(() => initialData.location ?? null)
  );
  let locationName = $state<string>('');
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let showLocationModal = $state(false);

  // ---- Opening hours ----

  const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
  const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

  const DEFAULT_SLOT: [number, number, number, number] = [10, 0, 22, 0]; // openH, openM, closeH, closeM

  function normalizeTime(time?: OpeningHourTime | number): [number, number] {
    if (typeof time === 'number') {
      const normalized = ((time % 24) + 24) % 24 || 0;
      let hour = Math.floor(normalized);
      let minute = Math.round((normalized - hour) * 60);
      if (minute === 60) {
        minute = 0;
        hour = (hour + 1) % 24;
      }
      return [hour, minute];
    }

    const hour = Math.max(0, Math.min(23, Math.floor(Number(time?.hour) || 0)));
    const minute = Math.max(0, Math.min(59, Math.floor(Number(time?.minute) || 0)));
    return [hour, minute];
  }

  function initSlot(
    pair?: [OpeningHourTime | number, OpeningHourTime | number]
  ): [number, number, number, number] {
    if (!pair) return [...DEFAULT_SLOT];
    const [oh, om] = normalizeTime(pair[0]);
    const [ch, cm] = normalizeTime(pair[1]);
    return [oh, om, ch, cm];
  }

  let isConstant = $state<boolean>(
    untrack(() => !(initialData.openingHours && initialData.openingHours.length === 7))
  );

  // Each slot: [openHour, openMin, closeHour, closeMin]
  const initialSlots = (() => {
    if (!isConstant && untrack(() => initialData.openingHours?.length === 7)) {
      return untrack(() => initialData.openingHours!.map(initSlot));
    }
    const base = initSlot(untrack(() => initialData.openingHours?.[0]));
    return !isConstant
      ? Array.from({ length: 7 }, () => [...base] as [number, number, number, number])
      : [base];
  })();
  let slots = $state<[number, number, number, number][]>(initialSlots);

  function toggleConstant() {
    isConstant = !isConstant;
    if (isConstant) {
      slots = [slots[0] ?? [...DEFAULT_SLOT]];
    } else {
      const base = slots[0] ?? [...DEFAULT_SLOT];
      slots = Array.from({ length: 7 }, () => [...base] as [number, number, number, number]);
    }
  }

  const DAY_LABELS = () => [
    m.monday(),
    m.tuesday(),
    m.wednesday(),
    m.thursday(),
    m.friday(),
    m.saturday(),
    m.sunday()
  ];

  // ---- Address (dynamic region hierarchy) ----

  let regionIds = $state<string[]>([]);
  let regionComplete = $state(false);
  let regionSectionTouched = $state(false);

  const initialRegionIds = untrack(() => {
    const addr = initialData.address;
    if (!addr?.region || addr.region.length === 0) return undefined;
    return addr.region.map((r) => (typeof r === 'string' ? r : r.id));
  });

  // ---- Games ----

  let games = $state<GameFormData[]>(
    untrack(
      () =>
        initialData.games?.map((g) => ({
          titleId: g.titleId,
          name: g.name,
          version: g.version,
          comment: g.comment,
          cost: g.cost,
          quantity: g.quantity
        })) ?? []
    )
  );

  function getGameTitleName(titleId: number) {
    return getGameName(titleId) ?? '';
  }

  function addGame() {
    const defaultTitleId = GAME_TITLES[0]?.id ?? 0;
    games = [
      ...games,
      {
        titleId: defaultTitleId,
        name: getGameTitleName(defaultTitleId),
        version: '',
        comment: '',
        cost: '',
        quantity: 1
      }
    ];
  }

  function removeGame(idx: number) {
    games = games.filter((_, i) => i !== idx);
  }

  function handleGameTitleChange(idx: number, nextTitleId: number) {
    const game = games[idx];
    if (!game) return;

    const previousTitleName = getGameTitleName(game.titleId);
    const nextTitleName = getGameTitleName(nextTitleId);
    const currentName = game.name.trim();

    game.titleId = nextTitleId;

    if (!currentName || currentName === previousTitleName) {
      game.name = nextTitleName;
    }
  }

  // ---- Submit ----

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    errorMessage = '';

    if (!name.trim()) {
      errorMessage = 'Shop name is required';
      return;
    }
    if (!location) {
      errorMessage = 'Location is required';
      return;
    }
    if (!regionComplete) {
      errorMessage = m.shop_region_incomplete();
      return;
    }

    const openingHours: [OpeningHourTime, OpeningHourTime][] = slots.map(([oh, om, ch, cm]) => [
      { hour: oh, minute: om },
      { hour: ch, minute: cm }
    ]);

    isSubmitting = true;
    try {
      await onSubmit({
        name: name.trim(),
        comment,
        address: {
          general: [],
          detailed: detailedAddress,
          region: regionIds
        },
        openingHours,
        location,
        games
      });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'An error occurred';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<form onsubmit={handleSubmit} class="flex flex-col gap-8">
  {#if errorMessage}
    <div class="alert alert-error">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <span>{errorMessage}</span>
    </div>
  {/if}

  <!-- Name -->
  <div class="form-control gap-1.5">
    <span class="label-text font-medium">{m.shop_name()}</span>
    <input
      id="shop-name"
      type="text"
      class="input input-bordered w-full"
      bind:value={name}
      required
    />
  </div>

  <!-- Comment -->
  <div class="form-control gap-1.5 pb-5">
    <span class="label-text font-medium">{m.shop_comment()}</span>
    <MarkdownEditor bind:value={comment} placeholder={m.shop_comment()} />
  </div>

  <!-- Address -->
  <div class="form-control gap-3">
    <span class="label-text font-medium">{m.shop_address()}</span>
    <div class="flex flex-col gap-1">
      <div
        onfocusin={() => {
          regionSectionTouched = false;
        }}
        onfocusout={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            regionSectionTouched = true;
          }
        }}
      >
        <RegionCascadeSelect bind:regionIds bind:regionComplete {initialRegionIds} />
      </div>

      {#if regionIds.length > 0 && !regionComplete && regionSectionTouched}
        <p class="text-warning text-xs">
          <i class="fa-solid fa-circle-info"></i>
          {m.shop_region_incomplete()}
        </p>
      {/if}
    </div>

    <!-- Detailed address -->
    <div class="mt-2 flex flex-col">
      <label class="label-text text-sm" for="shop-address-detailed"
        >{m.shop_address_detailed()}</label
      >
      <input
        id="shop-address-detailed"
        type="text"
        class="input input-bordered w-full"
        bind:value={detailedAddress}
      />
    </div>
  </div>

  <!-- Location -->
  <div class="form-control gap-3">
    <span class="label-text font-medium">{m.shop_location()}</span>
    <div class="bg-base-200/50 flex items-center gap-3 rounded-xl p-3">
      {#if location}
        <div class="flex flex-1 items-center gap-3">
          <i class="fa-solid fa-location-dot text-primary"></i>
          <div class="flex flex-col gap-0.5">
            {#if locationName}
              <span class="text-sm font-medium">{locationName}</span>
            {/if}
            <span class="font-mono {locationName ? 'text-xs opacity-70' : 'text-sm'}">
              {location.coordinates[1].toFixed(6)}, {location.coordinates[0].toFixed(6)}
            </span>
          </div>
        </div>
      {/if}
      <button
        type="button"
        class="btn btn-soft w-fit self-end"
        onclick={() => (showLocationModal = true)}
      >
        <i class="fa-solid fa-map-location-dot"></i>
        {m.pick_location()}
      </button>
    </div>
  </div>

  <!-- Opening Hours -->
  <div class="form-control gap-3">
    <div class="mb-2 flex w-full flex-wrap justify-between gap-2">
      <span class="label-text font-medium">{m.shop_opening_hours()}</span>
      <label class="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          class="toggle toggle-sm"
          checked={isConstant}
          onchange={toggleConstant}
        />
        <span class="text-sm">{m.shop_opening_hours_constant()}</span>
      </label>
    </div>
    <div class="flex flex-col">
      {#each slots as slot, idx (idx)}
        <div
          class="hover:bg-base-200 border-base-content/20 flex flex-wrap items-center justify-between gap-3 border p-3 transition not-first:border-t-transparent first:rounded-t-xl last:rounded-b-xl"
        >
          {#if !isConstant}
            <span class="text-sm font-medium">{DAY_LABELS()[idx]}</span>
          {/if}
          <div class="flex flex-wrap justify-end gap-3">
            <div class="flex items-center gap-2">
              <span class="flex-1 text-xs opacity-60">{m.shop_open_time()}</span>
              <select
                class="select select-bordered select-sm w-18 cursor-pointer"
                bind:value={slot[0]}
              >
                {#each HOUR_OPTIONS as h (h)}
                  <option value={h}>{String(h).padStart(2, '0')}</option>
                {/each}
              </select>
              <span class="text-xs">:</span>
              <select
                class="select select-bordered select-sm w-18 cursor-pointer"
                bind:value={slot[1]}
              >
                {#each MINUTE_OPTIONS as min (min)}
                  <option value={min}>{String(min).padStart(2, '0')}</option>
                {/each}
              </select>
            </div>
            <div class="flex items-center gap-2">
              <span class="flex-1 text-xs opacity-60">{m.shop_close_time()}</span>
              <select
                class="select select-bordered select-sm w-18 cursor-pointer"
                bind:value={slot[2]}
              >
                {#each HOUR_OPTIONS as h (h)}
                  <option value={h}>{String(h).padStart(2, '0')}</option>
                {/each}
              </select>
              <span class="text-xs">:</span>
              <select
                class="select select-bordered select-sm w-18 cursor-pointer"
                bind:value={slot[3]}
              >
                {#each MINUTE_OPTIONS as min (min)}
                  <option value={min}>{String(min).padStart(2, '0')}</option>
                {/each}
              </select>
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Games -->
  <div class="flex flex-col gap-3">
    <span class="label-text font-medium">{m.shop_games()}</span>

    {#each games as game, idx (idx)}
      <div class="border-base-content/20 flex flex-col gap-3 rounded-xl border p-4">
        <div class="flex items-center justify-between">
          <span class="font-medium opacity-60">#{idx + 1}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle"
            onclick={() => removeGame(idx)}
            aria-label="Remove game"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- Title -->
        <div class="form-control gap-1">
          <label class="label-text text-sm" for="shop-game-title-{idx}">{m.shop_game_title()}</label
          >
          <select
            id="shop-game-title-{idx}"
            class="select select-bordered w-full"
            value={game.titleId}
            onchange={(e) =>
              handleGameTitleChange(idx, Number((e.target as HTMLSelectElement).value))}
          >
            <option value={0}>{m.shop_select_game_title()}</option>
            {#each GAME_TITLES as g (g.id)}
              <option value={g.id}>{m[g.key]()}</option>
            {/each}
          </select>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <!-- Name -->
          <div class="form-control gap-1">
            <label class="label-text text-sm" for="shop-game-name-{idx}">{m.shop_game_name()}</label
            >
            <input
              id="shop-game-name-{idx}"
              type="text"
              class="input input-bordered w-full"
              bind:value={game.name}
            />
          </div>

          <!-- Version -->
          <div class="form-control gap-1">
            <label class="label-text text-sm" for="shop-game-version-{idx}"
              >{m.shop_game_version()}</label
            >
            <input
              id="shop-game-version-{idx}"
              type="text"
              class="input input-bordered w-full"
              bind:value={game.version}
            />
          </div>

          <!-- Cost -->
          <div class="form-control gap-1">
            <label class="label-text text-sm" for="shop-game-cost-{idx}">{m.shop_game_cost()}</label
            >
            <input
              id="shop-game-cost-{idx}"
              type="text"
              class="input input-bordered w-full"
              bind:value={game.cost}
            />
          </div>

          <!-- Quantity -->
          <div class="form-control gap-1">
            <label class="label-text text-sm" for="shop-game-quantity-{idx}"
              >{m.shop_game_quantity()}</label
            >
            <input
              id="shop-game-quantity-{idx}"
              type="number"
              class="input input-bordered w-full"
              bind:value={game.quantity}
              min="1"
            />
          </div>
        </div>

        <!-- Comment -->
        <div class="form-control mb-6 gap-1">
          <span class="label-text text-sm">{m.shop_game_comment()}</span>
          <MarkdownEditor
            bind:value={game.comment}
            placeholder={m.shop_game_comment()}
            minHeight="min-h-20"
          />
        </div>
      </div>
    {/each}

    <button type="button" class="btn btn-ghost btn-sm self-start" onclick={addGame}>
      <i class="fa-solid fa-plus"></i>
      {m.shop_add_game()}
    </button>
  </div>

  <!-- Submit -->
  <div class="border-base-content/20 flex justify-end gap-3 border-t pt-6">
    <button class="btn btn-ghost" disabled={isSubmitting} onclick={onCancel}>
      {m.cancel()}
    </button>
    <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
      {#if isSubmitting}
        <span class="loading loading-spinner loading-sm"></span>
      {/if}
      {submitLabel}
    </button>
  </div>
</form>

<LocationPickerModal
  bind:isOpen={showLocationModal}
  onLocationSelected={(loc: {
    longitude: number;
    latitude: number;
    name: string;
    address: string;
  }) => {
    location = {
      type: 'Point',
      coordinates: [loc.longitude, loc.latitude]
    };
    locationName = loc.name ?? '';
    if (loc.address && !detailedAddress) {
      detailedAddress = loc.address;
    }
  }}
/>
