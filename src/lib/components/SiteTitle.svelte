<script lang="ts">
  let { class: klass = '' } = $props();
  let element: HTMLSpanElement;
  let paddingRight = $state(0);

  const updatePadding = () => {
    if (element) {
      const width = element.offsetWidth;
      paddingRight = width * 0.01029;
    }
  };

  $effect(() => {
    updatePadding();

    window.addEventListener('resize', updatePadding);
    window.addEventListener('orientationchange', updatePadding);

    return () => {
      window.removeEventListener('resize', updatePadding);
      window.removeEventListener('orientationchange', updatePadding);
    };
  });
</script>

<a class="font-bold tracking-tight {klass}" href="/">
  <span
    bind:this={element}
    class="from-primary dark:via-secondary to-secondary dark:to-accent bg-gradient-to-br bg-clip-text text-transparent"
    style="padding-right: {paddingRight}px"
  >
    near
  </span><span class="text-base-content">cade</span>
</a>
