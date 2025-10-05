<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Globe from 'globe.gl';
  import type { GlobeInstance } from 'globe.gl';
  import { browser } from '$app/environment';
  import { MeshLambertMaterial, DoubleSide } from 'three';
  import * as topojson from 'topojson-client';
  import type { Topology } from 'topojson-specification';

  // Define the type for a single data point
  type DataPoint = {
    location: {
      latitude: number;
      longitude: number;
    };
    amount: number;
    color: string;
  };

  let { data }: { data: DataPoint[] } = $props();

  let globeEl: HTMLDivElement;
  let globe: GlobeInstance;

  // Debounce function to limit resize events
  const debounce = (fn: () => void, delay: number) => {
    let timeoutId: number;
    return () => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(fn, delay);
    };
  };

  // Handle window resizing
  const handleResize = debounce(() => {
    if (globeEl && globe) {
      globe.width(globeEl.offsetWidth);
      globe.height(globeEl.offsetHeight);
    }
  }, 100);

  onMount(async () => {
    globe = new Globe(globeEl)
      .backgroundColor('rgba(0,0,0,0)')
      .showGlobe(false)
      .showAtmosphere(false);

    try {
      const res = await fetch('//cdn.jsdelivr.net/npm/world-atlas/land-110m.json');
      if (!res.ok) throw new Error(`Failed to load land topojson: ${res.status}`);
      const landTopo = (await res.json()) as Topology;

      const landFeatures = (
        topojson.feature(landTopo, landTopo.objects.land) as { features: object[] }
      ).features;

      globe
        .polygonsData(landFeatures)
        .polygonCapMaterial(new MeshLambertMaterial({ color: 'darkslategrey', side: DoubleSide }))
        .polygonSideColor(() => 'rgba(0,0,0,0)')
        .polygonAltitude(-0.0005)
        .pointsData(
          data.map((item) => ({
            lat: item.location.latitude,
            lng: item.location.longitude,
            color: item.color,
            altitude: item.amount / 50
          }))
        )
        .pointAltitude('altitude')
        .pointRadius(0.15)
        .pointColor('color');
    } catch (err) {
      console.error(err);
    }

    window.addEventListener('resize', handleResize);

    // Set initial dimensions
    if (globeEl) {
      globe.width(globeEl.offsetWidth);
      globe.height(globeEl.offsetHeight);
    }
  });

  onDestroy(() => {
    if (browser) {
      window.removeEventListener('resize', handleResize);
      globe._destructor();
    }
  });
</script>

<div class="globe-container" bind:this={globeEl}></div>

<style lang="postcss">
  @reference "tailwindcss";

  .globe-container {
    @apply h-screen w-full cursor-grab touch-none select-none;
  }

  .globe-container:active {
    @apply cursor-grabbing;
  }
</style>
