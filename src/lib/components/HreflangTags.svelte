<script lang="ts">
  import { page } from '$app/state';
  import { locales } from '$lib/paraglide/runtime';
  import { getCanonicalUrl, getLocaleUrl } from '$lib/utils/seo';

  const canonical = $derived(getCanonicalUrl(page.url));
  const alternates = $derived(
    locales.map((locale) => ({
      hreflang: locale,
      href: getLocaleUrl(page.url, locale)
    }))
  );
</script>

<svelte:head>
  <link rel="canonical" href={canonical} />
  {#each alternates as { hreflang, href } (hreflang)}
    <link rel="alternate" {hreflang} {href} />
  {/each}
  <link rel="alternate" hreflang="x-default" href={canonical} />
</svelte:head>
