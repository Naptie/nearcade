<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { locales } from '$lib/paraglide/runtime';
  import LocationPickerModal from '$lib/components/LocationPickerModal.svelte';
  import type { Region } from '$lib/regions/types';

  type Props = {
    region: Region | null;
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
  };

  let { region, isOpen = $bindable(), onClose, onSaved }: Props = $props();

  let names = $state<Record<string, string>>({});
  let area = $state('');
  let population = $state('');
  let longitude = $state('');
  let latitude = $state('');
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let showLocationPicker = $state(false);

  const reset = () => {
    const r = region;
    if (!r) return;
    names = { ...r.name };
    area = r.area?.toString() ?? '';
    population = r.population?.toString() ?? '';
    longitude = r.location ? r.location.coordinates[0].toString() : '';
    latitude = r.location ? r.location.coordinates[1].toString() : '';
    errorMessage = '';
    showLocationPicker = false;
  };

  $effect(() => {
    if (isOpen) {
      reset();
    }
  });

  const handleLocationSelected = (selected: {
    name: string;
    city?: string;
    address?: string;
    latitude: number;
    longitude: number;
    confirmed?: boolean;
  }) => {
    longitude = selected.longitude.toFixed(6);
    latitude = selected.latitude.toFixed(6);
  };

  const clearLocation = () => {
    longitude = '';
    latitude = '';
  };

  const parseNumber = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!region) return;

    errorMessage = '';
    isSubmitting = true;

    try {
      const areaValue = parseNumber(area);
      const populationValue = parseNumber(population);
      const lng = parseNumber(longitude);
      const lat = parseNumber(latitude);

      const payload: {
        name: Record<string, string>;
        area: number | null;
        population: number | null;
        location: { type: 'Point'; coordinates: [number, number] } | null;
      } = {
        name: names,
        area: areaValue,
        population: populationValue,
        location: lng != null && lat != null ? { type: 'Point', coordinates: [lng, lat] } : null
      };

      const response = await fetch(`/api/admin/regions/${region.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok) {
        errorMessage = result.error ?? m.region_save_failed();
        return;
      }

      onSaved();
      isOpen = false;
    } catch (err) {
      console.error('Error saving region:', err);
      errorMessage = m.region_save_failed();
    } finally {
      isSubmitting = false;
    }
  };

  const handleCancel = () => {
    isOpen = false;
    onClose();
  };
</script>

{#if region}
  <div class="modal" class:modal-open={isOpen}>
    <div class="modal-box max-h-[90vh] max-w-2xl overflow-y-auto">
      <h3 class="mb-4 text-lg font-bold">
        {m.region_edit()} — {region.id}
      </h3>

      <form onsubmit={handleSubmit} class="space-y-4">
        <div class="bg-base-200 rounded-lg p-4">
          <h4 class="mb-2 font-medium">{m.region_names()}</h4>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {#each locales as locale (locale)}
              <div class="form-control">
                <label class="label" for="name-{locale}">
                  <span class="label-text">
                    {m.region_name_locale({ locale: locale.toUpperCase() })}
                  </span>
                </label>
                <input
                  id="name-{locale}"
                  type="text"
                  class="input input-bordered w-full"
                  bind:value={names[locale]}
                  placeholder={locale.toUpperCase()}
                />
              </div>
            {/each}
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="form-control">
            <label class="label" for="area">
              <span class="label-text">{m.region_area()} (km²)</span>
            </label>
            <input
              id="area"
              type="number"
              step="any"
              min="0"
              class="input input-bordered w-full"
              bind:value={area}
              placeholder={m.not_set()}
            />
          </div>

          <div class="form-control">
            <label class="label" for="population">
              <span class="label-text">{m.region_population()}</span>
            </label>
            <input
              id="population"
              type="number"
              step="1"
              min="0"
              class="input input-bordered w-full"
              bind:value={population}
              placeholder={m.not_set()}
            />
          </div>
        </div>

        <div class="bg-base-200 rounded-lg p-4">
          <h4 class="mb-2 font-medium">{m.region_location()}</h4>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="form-control">
              <label class="label" for="longitude">
                <span class="label-text">{m.longitude()}</span>
              </label>
              <input
                id="longitude"
                type="number"
                step="any"
                class="input input-bordered w-full"
                bind:value={longitude}
                placeholder={m.not_set()}
              />
            </div>

            <div class="form-control">
              <label class="label" for="latitude">
                <span class="label-text">{m.latitude()}</span>
              </label>
              <input
                id="latitude"
                type="number"
                step="any"
                class="input input-bordered w-full"
                bind:value={latitude}
                placeholder={m.not_set()}
              />
            </div>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              class="btn btn-soft btn-primary"
              onclick={() => (showLocationPicker = true)}
            >
              <i class="fa-solid fa-map-location-dot"></i>
              {m.region_select_location()}
            </button>
            {#if longitude || latitude}
              <button type="button" class="btn btn-soft" onclick={clearLocation}>
                <i class="fa-solid fa-eraser"></i>
                {m.region_clear_location()}
              </button>
            {/if}
          </div>
        </div>

        {#if errorMessage}
          <div class="alert alert-error">
            <i class="fa-solid fa-circle-xmark"></i>
            <span>{errorMessage}</span>
          </div>
        {/if}

        <div class="modal-action">
          <button type="button" class="btn" onclick={handleCancel} disabled={isSubmitting}>
            {m.cancel()}
          </button>
          <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
            {#if isSubmitting}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
            {m.save()}
          </button>
        </div>
      </form>
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

  <LocationPickerModal
    bind:isOpen={showLocationPicker}
    onLocationSelected={handleLocationSelected}
    title={m.region_select_location()}
  />
{/if}
