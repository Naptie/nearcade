<script lang="ts">
  import { untrack, tick } from 'svelte';
  import { m } from '$lib/paraglide/messages';
  import { GAMES } from '$lib/constants';
  import { base } from '$app/paths';
  import LocationPickerModal from '$lib/components/LocationPickerModal.svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import { getSupportedCountryByName, SUPPORTED_COUNTRIES } from '$lib/countries';
  import type { OpeningHourTime } from '$lib/types';

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
    openingHours: [OpeningHourTime, OpeningHourTime][];
    location: {
      type: 'Point';
      coordinates: [number, number];
    } | null;
    games: GameFormData[];
  }

  type AddressOption = {
    id: string;
    value: string;
    label: string;
    adcode?: string;
    supported?: boolean;
  };

  type Props = {
    initialData?: Partial<ShopFormData>;
    onSubmit: (data: ShopFormData) => Promise<void>;
    submitLabel?: string;
  };

  let { initialData = {}, onSubmit, submitLabel = m.save() }: Props = $props();

  // ---- Form state ----

  let name = $state(untrack(() => initialData.name ?? ''));
  let comment = $state(untrack(() => initialData.comment ?? ''));
  let detailedAddress = $state(untrack(() => initialData.address?.detailed ?? ''));
  let location = $state<ShopFormData['location']>(untrack(() => initialData.location ?? null));
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

  let openingHoursMode = $state<'constant' | 'per_day'>(
    untrack(() =>
      initialData.openingHours && initialData.openingHours.length === 7 ? 'per_day' : 'constant'
    )
  );

  // Each slot: [openHour, openMin, closeHour, closeMin]
  const initialSlots = (() => {
    if (openingHoursMode === 'per_day' && untrack(() => initialData.openingHours?.length === 7)) {
      return untrack(() => initialData.openingHours!.map(initSlot));
    }
    const base = initSlot(untrack(() => initialData.openingHours?.[0]));
    return openingHoursMode === 'per_day'
      ? Array.from({ length: 7 }, () => [...base] as [number, number, number, number])
      : [base];
  })();
  let slots = $state<[number, number, number, number][]>(initialSlots);

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

  // Prepared address options from the shop address endpoint
  const ADDRESS_OPTIONS_ENDPOINT = `${base}/api/shop/address-options`;

  let countryOptions = $state<AddressOption[]>([]);
  let selectedCountryName = $state('');
  let provinceOptions = $state<AddressOption[]>([]);
  let cityOptions = $state<AddressOption[]>([]);
  let countyOptions = $state<AddressOption[]>([]);

  let selectedProvinceName = $state('');
  let selectedProvinceAdcode = $state('');
  let selectedCityName = $state('');
  let selectedCityAdcode = $state('');
  let selectedCountyName = $state('');

  // Extra free-text fields beyond selects
  let extraFields = $state<string[]>([]);

  // Pending auto-fill data – applied reactively as sub-level options load.
  type PendingFill = {
    province?: { value: string; adcode: string };
    city?: { value: string; adcode: string };
    county?: { value: string };
    extras?: string[];
  };
  let pendingFill = $state<PendingFill | null>(null);

  let selectedCountryObj = $derived(getSupportedCountryByName(selectedCountryName));
  let countryLevels = $derived(selectedCountryObj?.levels ?? []);

  // selectSlots = 1 (country) + sub-levels for supported countries;
  // = 1 for an unsupported country with a name chosen; = 0 when no country is chosen.
  let selectSlots = $derived(
    selectedCountryName ? (selectedCountryObj ? 1 + countryLevels.length : 1) : 0
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
    // Level 3: county select only appears when city options are loaded
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

  async function fetchAddressOptions(dataset = 'countries', parentAdcode?: string) {
    const params = new URLSearchParams([
      ['dataset', dataset],
      ...(parentAdcode ? ([['parentAdcode', parentAdcode]] as [string, string][]) : [])
    ]);

    const response = await fetch(`${ADDRESS_OPTIONS_ENDPOINT}?${params}`);
    if (!response.ok) throw new Error(`Failed to load ${dataset} address options`);
    return (await response.json()) as AddressOption[];
  }

  // Load countries
  $effect(() => {
    fetchAddressOptions()
      .then((options) => {
        countryOptions = options;
      })
      .catch(console.error);
  });

  // Load provinces when country changes; apply pendingFill if present.
  $effect(() => {
    if (!selectedCountryObj) {
      provinceOptions = [];
      cityOptions = [];
      countyOptions = [];
      selectedProvinceName = '';
      selectedProvinceAdcode = '';
      selectedCityName = '';
      selectedCityAdcode = '';
      selectedCountyName = '';
      pendingFill = null;
      return;
    }
    if (selectedCountryObj.levels.length > 0) {
      const dataset = selectedCountryObj.levels[0].dataset;
      fetchAddressOptions(dataset)
        .then((options) => {
          provinceOptions = options;
          const pf = pendingFill;
          if (pf?.province) {
            const match = options.find((o) => o.value === pf.province!.value);
            if (match) {
              selectedProvinceName = match.value;
              selectedProvinceAdcode = match.adcode ?? '';
            } else {
              extraFields = pf.extras ?? [];
              pendingFill = null;
            }
          }
        })
        .catch(console.error);
    } else {
      // No province level – apply extras right away.
      const pf = pendingFill;
      if (pf) {
        extraFields = pf.extras ?? [];
        pendingFill = null;
      }
    }
  });

  // Load cities when province changes; apply pendingFill if present.
  $effect(() => {
    if (!selectedProvinceAdcode || !selectedCountryObj || selectedCountryObj.levels.length < 2) {
      cityOptions = [];
      selectedCityName = '';
      selectedCityAdcode = '';
      countyOptions = [];
      selectedCountyName = '';
      return;
    }
    const dataset = selectedCountryObj.levels[1].dataset;
    fetchAddressOptions(dataset, selectedProvinceAdcode)
      .then((options) => {
        cityOptions = options;
        const pf = pendingFill;
        if (pf?.city) {
          const match = options.find((o) => o.value === pf.city!.value);
          if (match) {
            selectedCityName = match.value;
            selectedCityAdcode = match.adcode ?? '';
          } else {
            extraFields = pf.extras ?? [];
            pendingFill = null;
          }
        } else if (pf && !pf.city) {
          extraFields = pf.extras ?? [];
          pendingFill = null;
        }
      })
      .catch(console.error);
  });

  // Load counties when city changes; apply pendingFill if present.
  $effect(() => {
    if (!selectedCityAdcode || !selectedCountryObj || selectedCountryObj.levels.length < 3) {
      countyOptions = [];
      selectedCountyName = '';
      // If there is no county level, apply pending extras here.
      const pf = pendingFill;
      if (pf && selectedCountryObj && selectedCountryObj.levels.length < 3 && selectedCityAdcode) {
        extraFields = pf.extras ?? [];
        pendingFill = null;
      }
      return;
    }
    const dataset = selectedCountryObj.levels[2].dataset;
    fetchAddressOptions(dataset, selectedCityAdcode)
      .then((options) => {
        countyOptions = options;
        const pf = pendingFill;
        if (pf) {
          if (pf.county) {
            const match = options.find((o) => o.value === pf.county!.value);
            if (match) {
              selectedCountyName = match.value;
            }
          }
          // Always apply extras and clear pendingFill at the deepest level.
          extraFields = pf.extras ?? [];
          pendingFill = null;
        }
      })
      .catch(console.error);
  });

  // Build the general address array from selects + extra fields.
  // Country addressName is always prepended for supported countries.
  let generalAddress = $derived.by(() => {
    const parts: string[] = [];
    if (selectedCountryObj) {
      parts.push(selectedCountryObj.addressName);
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

  // Auto-fill selects and extras from an array of stored general address parts.
  // Handles the new format (parts[0] = addressName) and the legacy format (no country name).
  async function autoFillFromAddressParts(parts: string[]): Promise<void> {
    if (!parts.length || countryOptions.length === 0) return;

    let partIdx = 0;
    let matchedCountry: (typeof SUPPORTED_COUNTRIES)[0] | undefined;

    // New format: parts[0] is the country's addressName (e.g. '中国')
    for (const country of SUPPORTED_COUNTRIES) {
      if (parts[0] === country.addressName) {
        matchedCountry = country;
        partIdx = 1;
        break;
      }
    }

    // Backward-compat: parts[0] might be a province name with no country prefix.
    if (!matchedCountry && parts.length > 0) {
      for (const country of SUPPORTED_COUNTRIES) {
        if (country.levels.length === 0) continue;
        const provinces = await fetchAddressOptions(country.levels[0].dataset).catch(() => []);
        const prov = provinces.find((p) => p.value === parts[0]);
        if (prov) {
          matchedCountry = country;
          partIdx = 0;
          break;
        }
      }
    }

    if (matchedCountry) {
      const subParts = parts.slice(partIdx);
      const fill: PendingFill = { extras: [] };
      let subIdx = 0;

      if (subParts[subIdx] && matchedCountry.levels.length > 0) {
        const provinces = await fetchAddressOptions(matchedCountry.levels[0].dataset).catch(
          () => []
        );
        const prov = provinces.find((p) => p.value === subParts[subIdx]);
        if (prov) {
          fill.province = { value: prov.value, adcode: prov.adcode ?? '' };
          subIdx++;

          if (subParts[subIdx] && matchedCountry.levels.length > 1 && prov.adcode) {
            const cities = await fetchAddressOptions(
              matchedCountry.levels[1].dataset,
              prov.adcode
            ).catch(() => []);
            const city = cities.find((c) => c.value === subParts[subIdx]);
            if (city) {
              fill.city = { value: city.value, adcode: city.adcode ?? '' };
              subIdx++;

              if (subParts[subIdx] && matchedCountry.levels.length > 2 && city.adcode) {
                const counties = await fetchAddressOptions(
                  matchedCountry.levels[2].dataset,
                  city.adcode
                ).catch(() => []);
                const county = counties.find((c) => c.value === subParts[subIdx]);
                if (county) {
                  fill.county = { value: county.value };
                  subIdx++;
                }
              }
            }
          }
        }
      }

      fill.extras = subParts.slice(subIdx).filter((p) => p.trim());
      pendingFill = fill;
      selectedCountryName = matchedCountry.name;
    } else {
      // Non-supported or unknown country.
      const countryOpt = countryOptions.find((o) => o.value === parts[0]);
      if (countryOpt) {
        selectedCountryName = parts[0];
        extraFields = parts.slice(1).filter((p) => p.trim());
      } else {
        extraFields = parts.filter((p) => p.trim());
      }
    }
  }

  // Auto-fill from a raw address string (e.g. from location picker).
  // Returns the remaining address after extracting the general parts.
  async function autoFillFromAddressString(raw: string): Promise<string> {
    let remaining = raw;

    for (const country of SUPPORTED_COUNTRIES) {
      if (country.levels.length === 0) continue;
      const provinces = await fetchAddressOptions(country.levels[0].dataset).catch(() => []);
      const prov = provinces.find((p) => remaining.startsWith(p.value));
      if (!prov) continue;

      remaining = remaining.slice(prov.value.length);
      const fill: PendingFill = {
        province: { value: prov.value, adcode: prov.adcode ?? '' },
        extras: []
      };

      if (country.levels.length >= 2 && prov.adcode) {
        const cities = await fetchAddressOptions(country.levels[1].dataset, prov.adcode).catch(
          () => []
        );
        const city = cities.find((c) => remaining.startsWith(c.value));
        if (city) {
          remaining = remaining.slice(city.value.length);
          fill.city = { value: city.value, adcode: city.adcode ?? '' };

          if (country.levels.length >= 3 && city.adcode) {
            const counties = await fetchAddressOptions(
              country.levels[2].dataset,
              city.adcode
            ).catch(() => []);
            const county = counties.find((c) => remaining.startsWith(c.value));
            if (county) {
              remaining = remaining.slice(county.value.length);
              fill.county = { value: county.value };
            }
          }
        }
      }

      // If this country was already selected, reset first to force the reactive chain.
      if (selectedCountryName === country.name) {
        selectedCountryName = '';
        await tick();
      }
      pendingFill = fill;
      selectedCountryName = country.name;
      return remaining; // remaining becomes the detailed address
    }

    return raw; // no match
  }

  // Pre-populate address from initialData – runs once when country options are available.
  let addressPrefilled = $state(false);
  $effect(() => {
    if (addressPrefilled || countryOptions.length === 0) return;
    if (!initialData.address?.general?.length) return;
    addressPrefilled = true;
    autoFillFromAddressParts(initialData.address.general).catch(console.error);
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
    <span class="label-text font-medium">{m.shop_comment()}</span>
    <MarkdownEditor bind:value={comment} placeholder={m.shop_comment()} />
  </div>

  <!-- Address -->
  <div class="form-control gap-3">
    <span class="label-text font-medium">{m.shop_address_general()}</span>

    <!-- Country select (always shown) -->
    <div class="flex flex-col gap-1">
      <label class="label-text text-sm" for="shop-address-country">{m.shop_address_country()}</label
      >
      <select
        id="shop-address-country"
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
        {#each countryOptions as option (option.id)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </div>

    <!-- Province select (for supported countries) -->
    {#if selectedCountryObj && selectedCountryObj.levels.length > 0 && provinceOptions.length > 0}
      <div class="flex flex-col gap-1">
        <label class="label-text text-sm" for="shop-address-province"
          >{m.shop_address_province()}</label
        >
        <select
          id="shop-address-province"
          class="select select-bordered w-full"
          bind:value={selectedProvinceName}
          onchange={(e) => {
            const target = e.target as HTMLSelectElement;
            const option = provinceOptions.find((o) => o.value === target.value);
            selectedProvinceAdcode = option?.adcode ?? '';
            selectedCityName = '';
            selectedCityAdcode = '';
            selectedCountyName = '';
          }}
        >
          <option value="">{m.shop_select_province()}</option>
          {#each provinceOptions as option (option.id)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- City select -->
    {#if selectedCountryObj && selectedCountryObj.levels.length > 1 && cityOptions.length > 0}
      <div class="flex flex-col gap-1">
        <label class="label-text text-sm" for="shop-address-city">{m.shop_address_city()}</label>
        <select
          id="shop-address-city"
          class="select select-bordered w-full"
          bind:value={selectedCityName}
          onchange={(e) => {
            const target = e.target as HTMLSelectElement;
            const option = cityOptions.find((o) => o.value === target.value);
            selectedCityAdcode = option?.adcode ?? '';
            selectedCountyName = '';
          }}
        >
          <option value="">{m.shop_select_city()}</option>
          {#each cityOptions as option (option.id)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- County select -->
    {#if selectedCountryObj && selectedCountryObj.levels.length > 2 && countyOptions.length > 0}
      <div class="flex flex-col gap-1">
        <label class="label-text text-sm" for="shop-address-county">{m.shop_address_county()}</label
        >
        <select
          id="shop-address-county"
          class="select select-bordered w-full"
          bind:value={selectedCountyName}
        >
          <option value="">{m.shop_select_county()}</option>
          {#each countyOptions as option (option.id)}
            <option value={option.value}>{option.label}</option>
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
          <label class="label-text text-sm" for="shop-game-title-{idx}">{m.shop_game_title()}</label
          >
          <select
            id="shop-game-title-{idx}"
            class="select select-bordered w-full"
            bind:value={game.titleId}
          >
            <option value={0}>{m.shop_select_game_title()}</option>
            {#each GAMES as g (g.id)}
              <option value={g.id}>{g.key}</option>
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
        <div class="form-control gap-1">
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
    // Extract general address parts from the address string and auto-select selects.
    // The remaining string (after general parts are removed) becomes the detailed address.
    if (loc.address) {
      autoFillFromAddressString(loc.address)
        .then((remaining) => {
          detailedAddress = remaining;
        })
        .catch(() => {
          if (!detailedAddress) detailedAddress = loc.address;
        });
    }
  }}
/>
