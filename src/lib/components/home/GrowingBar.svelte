<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    /** Target width in percent (0-100). */
    width: number;
    /** Stagger delay in ms before the bar starts growing. */
    delay?: number;
  }

  let { width, delay = 0 }: Props = $props();

  let barEl: HTMLDivElement | undefined = $state();

  // Animate the bar growing from 0 to the target width with a non-linear
  // (cubicOut) easing, driven by requestAnimationFrame with a wall-clock
  // timestamp so it is smooth and always lands exactly on the final value.
  // Re-runs every time the element is mounted (i.e. on each group switch).
  onMount(() => {
    const el = barEl;
    if (!el) return;

    const DURATION = 550;
    const start = performance.now() + delay;
    let raf = 0;

    const cubicOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const tick = (now: number) => {
      const elapsed = now - start;
      if (elapsed < 0) {
        el.style.width = '0%';
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(elapsed / DURATION, 1);
      el.style.width = `${cubicOut(t) * width}%`;
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        el.style.width = `${width}%`;
      }
    };

    el.style.width = '0%';
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });
</script>

<div bind:this={barEl} class="bg-primary h-full rounded-full" style="width: {width}%"></div>
