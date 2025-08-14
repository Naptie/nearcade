<script>
  import { m } from '$lib/paraglide/messages';
  import { onMount } from 'svelte';

  let scrollY = $state(0);

  const handleScroll = () => {
    scrollY = window.scrollY;
  };

  onMount(() => {
    window.addEventListener('scroll', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  });
</script>

<button
  class="btn btn-circle btn-primary btn-soft fixed right-3 bottom-8 z-100 shadow-lg transition duration-300 sm:right-6 md:right-8"
  class:opacity-0={scrollY < 200}
  class:pointer-events-none={scrollY < 200}
  aria-label={m.back_to_top()}
  onclick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
>
  <i class="fa-solid fa-arrow-up fa-lg"></i>
</button>
