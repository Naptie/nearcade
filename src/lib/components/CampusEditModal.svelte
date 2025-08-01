<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import LocationPickerModal from '$lib/components/LocationPickerModal.svelte';
  import type { Campus } from '$lib/types';

  interface Props {
    open?: boolean;
    campus?: Campus | null;
    universityId: string;
    isEditMode?: boolean;
    onSuccess?: () => void;
  }

  let {
    open = $bindable(false),
    campus = null,
    universityId,
    isEditMode = false,
    onSuccess = () => {}
  }: Props = $props();

  let form: HTMLFormElement;
  let isLocationPickerOpen = $state(false);
  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let selectedLocation = $state<
    | {
        name: string;
        city: string;
        address: string;
        latitude: number;
        longitude: number;
      }
    | undefined
  >(undefined);

  // Form data
  let formData = $state({
    name: campus?.name || '',
    address: campus?.address || '',
    latitude: campus?.location.coordinates[1] || 0,
    longitude: campus?.location.coordinates[0] || 0,
    province: campus?.province || '',
    city: campus?.city || '',
    district: campus?.district || ''
  });

  // Reset form when campus changes
  $effect(() => {
    if (campus) {
      formData = {
        name: campus.name || '',
        address: campus.address || '',
        latitude: campus.location.coordinates[1] || 0,
        longitude: campus.location.coordinates[0] || 0,
        province: campus.province || '',
        city: campus.city || '',
        district: campus.district || ''
      };
    } else {
      formData = {
        name: '',
        address: '',
        latitude: 0,
        longitude: 0,
        province: '',
        city: '',
        district: ''
      };
    }
  });

  function handleLocationSelected(location: typeof selectedLocation) {
    selectedLocation = location;
    if (!selectedLocation) return;
    formData.latitude = selectedLocation.latitude;
    formData.longitude = selectedLocation.longitude;
    formData.address = selectedLocation.address;
    formData.city = selectedLocation.city;
    const addressParts = selectedLocation.address.split(selectedLocation.city);
    formData.province = addressParts[0] || selectedLocation.city;
    const districtMatch = addressParts[1]?.match(/(.+?[区县市])/);
    formData.district = districtMatch ? districtMatch[1] : formData.district;
    isLocationPickerOpen = false;
  }

  function handleClose() {
    open = false;
    errorMessage = '';
  }
</script>

<!-- Modal -->
<dialog class="modal" class:modal-open={open}>
  <div class="modal-box max-w-2xl">
    <!-- Header -->
    <div class="mb-6 flex items-center justify-between">
      <h3 class="text-lg font-bold">
        {isEditMode ? m.edit_campus_info() : m.add_campus()}
      </h3>
    </div>

    <!-- Error Alert -->
    {#if errorMessage}
      <div class="alert alert-error mb-4">
        <i class="fa-solid fa-exclamation-triangle"></i>
        <span>{errorMessage}</span>
      </div>
    {/if}

    <!-- Form -->
    <form
      bind:this={form}
      method="POST"
      action={isEditMode ? '?/updateCampus' : '?/addCampus'}
      use:enhance={() => {
        return async ({ result }) => {
          isSubmitting = false;

          if (result.type === 'success') {
            await invalidateAll();
            onSuccess();
            handleClose();
          } else if (result.type === 'failure') {
            errorMessage = (result.data?.message as string) || m.form_validation_error();
          } else if (result.type === 'error') {
            errorMessage = result.error?.message || 'An error occurred';
          }
        };
      }}
      class="space-y-4"
    >
      <!-- Hidden fields -->
      <input type="hidden" name="universityId" value={universityId} />
      {#if isEditMode && campus}
        <input type="hidden" name="campusId" value={campus.id} />
      {/if}
      <input type="hidden" name="latitude" bind:value={formData.latitude} />
      <input type="hidden" name="longitude" bind:value={formData.longitude} />

      <!-- Campus Name -->
      <div class="form-control flex-1">
        <label class="label" for="campus-name">
          <span class="label-text">{m.campus_name()}</span>
        </label>
        <input
          id="campus-name"
          name="name"
          type="text"
          bind:value={formData.name}
          placeholder={m.main_campus()}
          class="input input-bordered w-full"
          required
        />
      </div>

      <div class="flex gap-2">
        <!-- Campus Address -->
        <div class="form-control flex-1">
          <label class="label" for="campus-province">
            <span class="label-text">{m.province()} </span>
          </label>
          <input
            id="campus-province"
            name="province"
            type="text"
            bind:value={formData.province}
            placeholder={m.province()}
            class="input input-bordered"
            required
          />
        </div>
        <div class="form-control flex-1">
          <label class="label" for="campus-city">
            <span class="label-text">{m.city()} </span>
          </label>
          <input
            id="campus-city"
            name="city"
            type="text"
            bind:value={formData.city}
            placeholder={m.city()}
            class="input input-bordered"
            required
          />
        </div>
        <div class="form-control flex-1">
          <label class="label" for="campus-district">
            <span class="label-text">{m.district()} </span>
          </label>
          <input
            id="campus-district"
            name="district"
            type="text"
            bind:value={formData.district}
            placeholder={m.district()}
            class="input input-bordered"
            required
          />
        </div>
      </div>

      <!-- Campus Address -->
      <div class="form-control">
        <label class="label" for="campus-address">
          <span class="label-text">{m.campus_address()}</span>
        </label>
        <div class="flex gap-2">
          <input
            id="campus-address"
            name="address"
            type="text"
            bind:value={formData.address}
            placeholder={m.campus_address()}
            class="input input-bordered flex-1"
            required
          />
          <button type="button" class="btn btn-soft" onclick={() => (isLocationPickerOpen = true)}>
            <i class="fa-solid fa-map-marker-alt"></i>
            {m.pick_location()}
          </button>
        </div>
      </div>

      <!-- Location Info -->
      {#if selectedLocation}
        <div class="bg-base-200 flex items-center gap-2 rounded-lg p-3">
          <i class="fa-solid fa-map-marker-alt text-primary"></i>
          <div>
            <p class="font-medium">{selectedLocation.name}</p>
            <p class="text-base-content/60 text-xs">
              {selectedLocation.longitude.toFixed(6)}, {selectedLocation.latitude.toFixed(6)}
            </p>
          </div>
        </div>
      {/if}

      <!-- Form Actions -->
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={handleClose}>
          {m.cancel()}
        </button>
        <button type="submit" class="btn btn-soft btn-primary" disabled={isSubmitting}>
          {#if isSubmitting}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            <i class="fa-solid fa-save"></i>
          {/if}
          {m.save_campus()}
        </button>
      </div>
    </form>
  </div>
</dialog>

<!-- Location Picker Modal -->
<LocationPickerModal
  bind:isOpen={isLocationPickerOpen}
  title={m.pick_location()}
  onLocationSelected={handleLocationSelected}
/>

<style lang="postcss">
  @reference "tailwindcss";

  .label-text {
    @apply text-sm;
  }
</style>
