<script lang="ts">
  import { escapeJsonLd } from '$lib/utils/seo';

  interface Props {
    schema: object | object[];
  }

  let { schema }: Props = $props();

  const jsonLd = $derived(escapeJsonLd(schema));
</script>

<svelte:head>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html `<script type="application/ld+json">${jsonLd}</` + `script>`}
</svelte:head>
