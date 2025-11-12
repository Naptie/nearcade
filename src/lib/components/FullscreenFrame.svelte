<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { quintOut } from 'svelte/easing';
  import { crossfade } from 'svelte/transition';

  let { children } = $props();

  let isFullscreen = $state(false);
  let doScale = $state(false);

  let previewElement = $state<HTMLElement | null>(null);
  let windowWidth = $state(0);
  let previewWidth = $state(1);
  let scaleFactor = $derived(
    Math.min(windowWidth * (0.2 * Math.exp(-windowWidth) + 0.8), 1280) / previewWidth
  );

  const [send, receive] = crossfade({
    duration: 400,
    easing: quintOut
  });

  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      isFullscreen = true;
      await tick();
      doScale = true;
    } else {
      doScale = false;
      await tick();
      isFullscreen = false;
    }
  };

  const handleResize = () => {
    windowWidth = window.innerWidth;
  };

  onMount(() => {
    if (previewElement) {
      previewWidth = previewElement.offsetWidth;
    }
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
{#if !isFullscreen}
  <div
    class="flex cursor-pointer items-center justify-center"
    in:receive={{ key: children }}
    out:send={{ key: children }}
    onclick={toggleFullscreen}
    bind:this={previewElement}
  >
    {@render children()}
  </div>
{/if}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="fixed top-0 left-0 z-1000 flex h-screen w-screen items-center justify-center transition-[background-color] {isFullscreen
    ? 'bg-black/80'
    : 'bg-transparent'}"
  class:pointer-events-none={!isFullscreen}
  onclick={toggleFullscreen}
>
  {#if isFullscreen}
    <div in:receive={{ key: children }} out:send={{ key: children }}>
      <div
        class="flex items-center justify-center transition ease-out"
        style="scale: {(doScale ? scaleFactor : 1) * 100}%"
      >
        {@render children()}
      </div>
    </div>
  {/if}
</div>
