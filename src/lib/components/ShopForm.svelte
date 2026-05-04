<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { GAMES } from '$lib/constants';
  import { base } from '$app/paths';
  import LocationPickerModal from '$lib/components/LocationPickerModal.svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import { getSupportedCountryByName } from '$lib/countries';
  import type { GlobeFeatureCollection, GlobeFeature } from '$lib/utils/globe/geojson';

  // ---- Types ----

  export interface GameFormData {
    titleId: number;
    name: string;
    version: string;
    comment: string;
    cost: string;
    quantity: number;
  }

  export interface ShopFormData {
    name: string;
    comment: string;
    address: {
      general: string[];
      detailed: string;
    };
    openingHours: [number, number][];
    location: {
      type: 'Point';
      coordinates: [number, number];
    } | null;
    games: GameFormData[];
  }

  type Props = {
    initialData?: Partial<ShopFormData>;
    onSubmit: (data: ShopFormData) => Promise<void>;
    submitLabel?: string;
  };

  let { initialData = {}, onSubmit, submitLabel = m.save() }: Props = $props();

  // ---- Form state ----

  let name = $state(initialData.name ?? '');
  let comment = $state(initialData.comment ?? '');
  let detailedAddress = $state(initialData.address?.detailed ?? '');
  let location = $state<ShopFormData['location']>(initialData.location ?? null);
  let locationName = $state<string>('');
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let showLocationModal = $state(false);

  // ---- Opening hours ----

  const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
  const MINUTE_OPTIONS = [0, 15, 30, 45];

  function decimalToHourMin(val: number): [number, number] {
    const h = Math.floor(val);
    const m = Math.round((val - h) * 60);
    return [h, m];
  }

  function hourMinToDecimal(h: number, m: number): number {
    return h + m / 60;
  }

  const DEFAULT_SLOT: [number, number, number, number] = [10, 0, 22, 0]; // openH, openM, closeH, closeM

  function initSlot(pair?: [number, number]): [number, number, number, number] {
    if (!pair) return [...DEFAULT_SLOT];
    const [oh, om] = decimalToHourMin(pair[0]);
    const [ch, cm] = decimalToHourMin(pair[1]);
    return [oh, om, ch, cm];
  }

  let openingHoursMode = $state<'constant' | 'per_day'>(
    initialData.openingHours && initialData.openingHours.length === 7 ? 'per_day' : 'constant'
  );

  // Each slot: [openHour, openMin, closeHour, closeMin]
  let slots = $state<[number, number, number, number][]>(() => {
    if (openingHoursMode === 'per_day' && initialData.openingHours?.length === 7) {
      return initialData.openingHours.map(initSlot);
    }
    const base = initSlot(initialData.openingHours?.[0]);
    return openingHoursMode === 'per_day'
      ? Array.from({ length: 7 }, () => [...base] as [number, number, number, number])
      : [base];
  });

  function setOpeningHoursMode(mode: 'constant' | 'per_day') {
    openingHoursMode = mode;
    if (mode === 'constant') {
      slots = [slots[0] ?? [...DEFAULT_SLOT]];
    } else {
      const base = slots[0] ?? [...DEFAULT_SLOT];
      slots = Array.from({ length: 7 }, () => [...base] as [number, number, number, number]);
    }
  }

  const DAY_LABELS = () => [
    m.sunday(),
    m.monday(),
    m.tuesday(),
    m.wednesday(),
    m.thursday(),
    m.friday(),
    m.saturday()
  ];

  // ---- Address ----

  // Countries from world GeoJSON
  let worldFeatures = $state<GlobeFeature[]>([]);
  let selectedCountryName = $state('');
  let provinceFeatures = $state<GlobeFeature[]>([]);
  let cityFeatures = $state<GlobeFeature[]>([]);
  let countyFeatures = $state<GlobeFeature[]>([]);

  let selectedProvinceName = $state('');
  let selectedProvinceAdcode = $state('');
  let selectedCityName = $state('');
  let selectedCityAdcode = $state('');
  let selectedCountyName = $state('');

  // Extra free-text fields beyond selects
  let extraFields = $state<string[]>([]);

  let selectedCountryObj = $derived(getSupportedCountryByName(selectedCountryName));
  let countryLevels = $derived(selectedCountryObj?.levels ?? []);

  // For a supported country: select fields are the sub-national levels (province/city/county).
  // For a non-supported country: the country name itself is the single address part.
  // The country select is always shown but is the pivot, not counted separately.
  let selectSlots = $derived(
    selectedCountryObj ? countryLevels.length : selectedCountryName ? 1 : 0
  );

  // Total address parts = select-driven parts + extra free-text fields (max 4)
  let totalParts = $derived(selectSlots + extraFields.length);
  const MAX_PARTS = 4;

  // Whether all currently-visible selects have been chosen (gating extra inputs)
  let allSelectsFilled = $derived.by(() => {
    if (!selectedCountryName) return false;
    if (!selectedCountryObj) return true; // non-supported: country chosen = done
    const levels = selectedCountryObj.levels;
    if (levels.length === 0) return true;
    if (!selectedProvinceName) return false;
    if (levels.length === 1) return true;
    if (!selectedCityName) return false;
    if (levels.length === 2) return true;
    // Level 3: county select only appears when cityFeatures are loaded
    // – we allow adding extra fields once city is chosen even if counties aren't needed
    return true;
  });

  function addExtraField() {
    if (totalParts < MAX_PARTS) {
      extraFields = [...extraFields, ''];
    }
  }

  function removeExtraField(idx: number) {
    extraFields = extraFields.filter((_, i) => i !== idx);
  }

  // Load world countries
  $effect(() => {
    fetch(`${base}/api/globe/geojson?dataset=world`)
      .then((r) => r.json() as Promise<GlobeFeatureCollection>)
      .then((data) => {
        worldFeatures = data.features.filter((f) => f.properties.name);
      })
      .catch(console.error);
  });

  // Load provinces when country changes
  $effect(() => {
    if (!selectedCountryObj) {
      provinceFeatures = [];
      cityFeatures = [];
      countyFeatures = [];
      selectedProvinceName = '';
      selectedProvinceAdcode = '';
      selectedCityName = '';
      selectedCityAdcode = '';
      selectedCountyName = '';
      return;
    }
    if (selectedCountryObj.levels.length > 0) {
      const dataset = selectedCountryObj.levels[0].dataset;
      fetch(`${base}/api/globe/geojson?dataset=${dataset}`)
        .then((r) => r.json() as Promise<GlobeFeatureCollection>)
        .then((data) => {
          provinceFeatures = data.features;
        })
        .catch(console.error);
    }
  });

  // Load cities when province changes
  $effect(() => {
    if (!selectedProvinceAdcode || !selectedCountryObj || selectedCountryObj.levels.length < 2) {
      cityFeatures = [];
      selectedCityName = '';
      selectedCityAdcode = '';
      countyFeatures = [];
      selectedCountyName = '';
      return;
    }
    const dataset = selectedCountryObj.levels[1].dataset;
    fetch(`${base}/api/globe/geojson?dataset=${dataset}&parentAdcode=${selectedProvinceAdcode}`)
      .then((r) => r.json() as Promise<GlobeFeatureCollection>)
      .then((data) => {
        cityFeatures = data.features;
      })
      .catch(console.error);
  });

  // Load counties when city changes
  $effect(() => {
    if (!selectedCityAdcode || !selectedCountryObj || selectedCountryObj.levels.length < 3) {
      countyFeatures = [];
      selectedCountyName = '';
      return;
    }
    const dataset = selectedCountryObj.levels[2].dataset;
    fetch(`${base}/api/globe/geojson?dataset=${dataset}&parentAdcode=${selectedCityAdcode}`)
      .then((r) => r.json() as Promise<GlobeFeatureCollection>)
      .then((data) => {
        countyFeatures = data.features;
      })
      .catch(console.error);
  });

  // Build the general address array from selects + extra fields
  let generalAddress = $derived.by(() => {
    const parts: string[] = [];
    if (selectedCountryObj) {
      if (selectedProvinceName) parts.push(selectedProvinceName);
      if (selectedCityName) parts.push(selectedCityName);
      if (selectedCountyName) parts.push(selectedCountyName);
    } else if (selectedCountryName) {
      parts.push(selectedCountryName);
    }
    for (const f of extraFields) {
      if (f.trim()) parts.push(f.trim());
    }
    return parts;
  });

  // Pre-populate address from initialData
  $effect(() => {
    if (!initialData.address?.general) return;
    const parts = initialData.address.general;
    // Try to match to a country
    // Just populate extra fields if no country match
    extraFields = [...parts];
  });

  // ---- Games ----

  let games = $state<GameFormData[]>(
    initialData.games?.map((g) => ({
      titleId: g.titleId,
      name: g.name,
      version: g.version,
      comment: g.comment,
      cost: g.cost,
      quantity: g.quantity
    })) ?? []
  );

  function addGame() {
    games = [
      ...games,
      { titleId: GAMES[0].id, name: '', version: '', comment: '', cost: '', quantity: 1 }
    ];
  }

  function removeGame(idx: number) {
    games = games.filter((_, i) => i !== idx);
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

    const openingHours: [number, number][] = slots.map(([oh, om, ch, cm]) => [
      hourMinToDecimal(oh, om),
      hourMinToDecimal(ch, cm)
    ]);

    isSubmitting = true;
    try {
      await onSubmit({
        name: name.trim(),
        comment,
        address: {
          general: generalAddress,
          detailed: detailedAddress
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
    <label class="label" for="shop-name">
      <span class="label-text font-medium">{m.shop_name()}</span>
    </label>
    <input
      id="shop-name"
      type="text"
      class="input input-bordered w-full"
      bind:value={name}
      required
    />
  </div>

  <!-- Comment -->
  <div class="form-control gap-1.5">
    <label class="label">
      <span class="label-text font-medium">{m.shop_comment()}</span>
    </label>
    <MarkdownEditor bind:value={comment} placeholder={m.shop_comment()} />
  </div>

  <!-- Address -->
  <div class="form-control gap-3">
    <span class="label-text font-medium">{m.shop_address_general()}</span>

    <!-- Country select (always shown) -->
    <div class="flex flex-col gap-1">
      <label class="label-text text-sm">{m.shop_address_country()}</label>
      <select
        class="select select-bordered w-full"
        bind:value={selectedCountryName}
        onchange={() => {
          selectedProvinceName = '';
          selectedProvinceAdcode = '';
          selectedCityName = '';
          selectedCityAdcode = '';
          selectedCountyName = '';
          extraFields = [];
        }}
      >
        <option value="">{m.shop_select_country()}</option>
        {#each worldFeatures as f (f.properties.featureId)}
          <option value={f.properties.name}>{f.properties.name}</option>
        {/each}
      </select>
    </div>

    <!-- Province select (for supported countries) -->
    {#if selectedCountryObj && selectedCountryObj.levels.length > 0 && provinceFeatures.length > 0}
      <div class="flex flex-col gap-1">
        <label class="label-text text-sm">{m.shop_address_province()}</label>
        <select
          class="select select-bordered w-full"
          bind:value={selectedProvinceName}
          onchange={(e) => {
            const target = e.target as HTMLSelectElement;
            const feat = provinceFeatures.find((f) => f.properties.name === target.value);
            selectedProvinceAdcode = feat?.properties.adcode ?? '';
            selectedCityName = '';
            selectedCityAdcode = '';
            selectedCountyName = '';
          }}
        >
          <option value="">{m.shop_select_province()}</option>
          {#each provinceFeatures as f (f.properties.featureId)}
            <option value={f.properties.name}>{f.properties.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- City select -->
    {#if selectedCountryObj && selectedCountryObj.levels.length > 1 && cityFeatures.length > 0}
      <div class="flex flex-col gap-1">
        <label class="label-text text-sm">{m.shop_address_city()}</label>
        <select
          class="select select-bordered w-full"
          bind:value={selectedCityName}
          onchange={(e) => {
            const target = e.target as HTMLSelectElement;
            const feat = cityFeatures.find((f) => f.properties.name === target.value);
            selectedCityAdcode = feat?.properties.adcode ?? '';
            selectedCountyName = '';
          }}
        >
          <option value="">{m.shop_select_city()}</option>
          {#each cityFeatures as f (f.properties.featureId)}
            <option value={f.properties.name}>{f.properties.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- County select -->
    {#if selectedCountryObj && selectedCountryObj.levels.length > 2 && countyFeatures.length > 0}
      <div class="flex flex-col gap-1">
        <label class="label-text text-sm">{m.shop_address_county()}</label>
        <select class="select select-bordered w-full" bind:value={selectedCountyName}>
          <option value="">{m.shop_select_county()}</option>
          {#each countyFeatures as f (f.properties.featureId)}
            <option value={f.properties.name}>{f.properties.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- Extra free-text fields (only shown after all selects are filled) -->
    {#if allSelectsFilled}
      {#each extraFields as extraField, idx (idx)}
        <div class="flex items-center gap-2">
          <input
            type="text"
            class="input input-bordered flex-1"
            value={extraField}
            oninput={(e) => {
              extraFields[idx] = (e.target as HTMLInputElement).value;
            }}
          />
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-circle"
            onclick={() => removeExtraField(idx)}
            aria-label="Remove field"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      {/each}

      {#if totalParts < MAX_PARTS}
        <button type="button" class="btn btn-ghost btn-sm self-start" onclick={addExtraField}>
          <i class="fa-solid fa-plus"></i>
          {m.shop_address_add_field()}
        </button>
      {/if}
    {/if}

    <!-- Detailed address -->
    <div class="mt-2 flex flex-col gap-1">
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

  <!-- Opening Hours -->
  <div class="form-control gap-3">
    <span class="label-text font-medium">{m.shop_opening_hours()}</span>

    <div class="flex gap-4">
      <label class="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          class="radio radio-sm"
          name="opening-hours-mode"
          value="constant"
          checked={openingHoursMode === 'constant'}
          onchange={() => setOpeningHoursMode('constant')}
        />
        <span class="text-sm">{m.shop_opening_hours_constant()}</span>
      </label>
      <label class="flex cursor-pointer items-center gap-2">
        <input
          type="radio"
          class="radio radio-sm"
          name="opening-hours-mode"
          value="per_day"
          checked={openingHoursMode === 'per_day'}
          onchange={() => setOpeningHoursMode('per_day')}
        />
        <span class="text-sm">{m.shop_opening_hours_per_day()}</span>
      </label>
    </div>

    {#each slots as slot, idx (idx)}
      <div class="border-base-300 flex flex-wrap items-center gap-3 rounded-lg border p-3">
        {#if openingHoursMode === 'per_day'}
          <span class="w-16 text-sm font-medium">{DAY_LABELS()[idx]}</span>
        {/if}
        <div class="flex items-center gap-2">
          <span class="text-xs opacity-60">{m.shop_open_time()}</span>
          <select class="select select-bordered select-sm" bind:value={slot[0]}>
            {#each HOUR_OPTIONS as h (h)}
              <option value={h}>{String(h).padStart(2, '0')}</option>
            {/each}
          </select>
          <span class="text-xs">:</span>
          <select class="select select-bordered select-sm" bind:value={slot[1]}>
            {#each MINUTE_OPTIONS as min (min)}
              <option value={min}>{String(min).padStart(2, '0')}</option>
            {/each}
          </select>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs opacity-60">{m.shop_close_time()}</span>
          <select class="select select-bordered select-sm" bind:value={slot[2]}>
            {#each HOUR_OPTIONS as h (h)}
              <option value={h}>{String(h).padStart(2, '0')}</option>
            {/each}
          </select>
          <span class="text-xs">:</span>
          <select class="select select-bordered select-sm" bind:value={slot[3]}>
            {#each MINUTE_OPTIONS as min (min)}
              <option value={min}>{String(min).padStart(2, '0')}</option>
            {/each}
          </select>
        </div>
      </div>
    {/each}
  </div>

  <!-- Location -->
  <div class="form-control gap-3">
    <span class="label-text font-medium">{m.shop_location()}</span>
    {#if location}
      <div class="bg-base-200 flex items-start gap-3 rounded-lg p-3">
        <i class="fa-solid fa-location-dot text-primary mt-0.5"></i>
        <div class="flex flex-col gap-0.5">
          {#if locationName}
            <span class="text-sm font-medium">{locationName}</span>
          {/if}
          <span class="font-mono text-xs opacity-70">
            {location.coordinates[1].toFixed(6)}, {location.coordinates[0].toFixed(6)}
          </span>
        </div>
      </div>
    {/if}
    <button type="button" class="btn btn-soft w-fit" onclick={() => (showLocationModal = true)}>
      <i class="fa-solid fa-map-location-dot"></i>
      {location ? m.save_location() : m.a_place_on_map()}
    </button>
  </div>

  <!-- Games -->
  <div class="form-control gap-3">
    <span class="label-text font-medium">{m.shop_games()}</span>

    {#each games as game, idx (idx)}
      <div class="border-base-300 flex flex-col gap-3 rounded-xl border p-4">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium opacity-60">#{idx + 1}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-circle"
            onclick={() => removeGame(idx)}
            aria-label="Remove game"
          >
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- Title -->
        <div class="form-control gap-1">
          <label class="label-text text-sm">{m.shop_game_title()}</label>
          <select class="select select-bordered" bind:value={game.titleId}>
            <option value={0}>{m.shop_select_game_title()}</option>
            {#each GAMES as g (g.id)}
              <option value={g.id}>{g.key}</option>
            {/each}
          </select>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <!-- Name -->
          <div class="form-control gap-1">
            <label class="label-text text-sm">{m.shop_game_name()}</label>
            <input type="text" class="input input-bordered" bind:value={game.name} />
          </div>

          <!-- Version -->
          <div class="form-control gap-1">
            <label class="label-text text-sm">{m.shop_game_version()}</label>
            <input type="text" class="input input-bordered" bind:value={game.version} />
          </div>

          <!-- Cost -->
          <div class="form-control gap-1">
            <label class="label-text text-sm">{m.shop_game_cost()}</label>
            <input type="text" class="input input-bordered" bind:value={game.cost} />
          </div>

          <!-- Quantity -->
          <div class="form-control gap-1">
            <label class="label-text text-sm">{m.shop_game_quantity()}</label>
            <input type="number" class="input input-bordered" bind:value={game.quantity} min="1" />
          </div>
        </div>

        <!-- Comment -->
        <div class="form-control gap-1">
          <label class="label-text text-sm">{m.shop_game_comment()}</label>
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
  <div class="border-base-300 flex justify-end gap-3 border-t pt-6">
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
  onLocationSelected={(loc) => {
    location = {
      type: 'Point',
      coordinates: [loc.longitude, loc.latitude]
    };
    locationName = loc.name ?? '';
    // Pre-populate detailed address only if currently empty
    if (!detailedAddress && loc.address) {
      detailedAddress = loc.address;
    }
  }}
/>
