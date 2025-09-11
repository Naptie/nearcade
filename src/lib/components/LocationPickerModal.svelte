<script lang="ts">
  import { PUBLIC_TENCENT_MAPS_KEY } from '$env/static/public';
  import { m } from '$lib/paraglide/messages';

  let {
    isOpen = $bindable(false),
    title = m.select_location_on_map(),
    onLocationSelected = () => {}
  } = $props();

  let mapIframe = $state<HTMLIFrameElement>();
  let selectedLocation = $state<{
    name: string;
    city: string;
    address: string;
    latitude: number;
    longitude: number;
  } | null>(null);

  $effect(() => {
    if (mapIframe && isOpen) {
      const handleMessage = (event: MessageEvent) => {
        const loc = event.data;
        if (loc && loc.module === 'locationPicker') {
          console.debug('Received location from map iframe:', loc);
          selectedLocation = {
            name: loc.poiname,
            city: loc.cityname,
            address: loc.poiaddress,
            latitude: loc.latlng.lat,
            longitude: loc.latlng.lng
          };
        }
      };

      window.addEventListener('message', handleMessage, false);

      return () => {
        window.removeEventListener('message', handleMessage, false);
      };
    }
  });

  const handleSave = () => {
    if (selectedLocation) {
      onLocationSelected(selectedLocation);
      isOpen = false;
      selectedLocation = null;
    }
  };

  const handleCancel = () => {
    isOpen = false;
    selectedLocation = null;
  };
</script>

<div class="modal" class:modal-open={isOpen}>
  <div class="modal-box max-w-4xl">
    <h3 class="mb-4 text-lg font-bold">{title}</h3>

    <!-- Map Container -->
    <div class="mb-4 flex-1">
      <iframe
        bind:this={mapIframe}
        frameborder="0"
        title="Map Location Picker"
        class="h-[60vh] w-full rounded-lg border"
        src="https://apis.map.qq.com/tools/locpicker?search=1&type=1&key={PUBLIC_TENCENT_MAPS_KEY}&referer=nearcade"
      ></iframe>
    </div>

    <!-- Selected Location Display -->
    {#if selectedLocation}
      <div class="bg-base-200 mb-4 flex items-center gap-2 rounded-lg p-3">
        <i class="fa-solid fa-map-marker-alt text-primary"></i>
        <div>
          <p class="font-medium">{selectedLocation.name}</p>
          <p class="text-base-content/60 text-xs">
            {selectedLocation.longitude.toFixed(6)}, {selectedLocation.latitude.toFixed(6)}
          </p>
        </div>
      </div>
    {/if}

    <!-- Modal Actions -->
    <div class="modal-action">
      <button class="btn" onclick={handleCancel}>
        {m.cancel()}
      </button>
      <button class="btn btn-primary" disabled={!selectedLocation} onclick={handleSave}>
        {m.save_location()}
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
