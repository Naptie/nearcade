<script lang="ts">
  import { page } from '$app/state';
  import { getLocale, locales } from '$lib/paraglide/runtime';
  import { getCanonicalUrl, getOgLocale, buildWebSiteSchema } from '$lib/utils/seo';
  import JsonLd from './JsonLd.svelte';
  import HreflangTags from './HreflangTags.svelte';
  import { browser } from '$app/environment';

  const canonical = $derived(getCanonicalUrl(page.url));
  const locale = $derived(getLocale());
  const ogLocale = $derived(getOgLocale(locale));
  const alternateLocales = $derived(locales.filter((l) => l !== locale));
  const siteSchema = $derived(
    buildWebSiteSchema(page.url.origin, `${page.url.origin}/shops?q={search_term_string}`)
  );
</script>

<HreflangTags />

<svelte:head>
  <meta property="og:url" content={canonical} />
  <meta property="og:locale" content={ogLocale} />
  {#each alternateLocales as l (l)}
    <meta property="og:locale:alternate" content={getOgLocale(l)} />
  {/each}
  <meta name="twitter:site" content="@nearcade" />
  {#if browser}
    <script>
      (function () {
        if (location.hostname === 'localhost') return;
        var bp = document.createElement('script');
        var curProtocol = window.location.protocol.split(':')[0];
        if (curProtocol === 'https') {
          bp.src = 'https://zz.bdstatic.com/linksubmit/push.js';
        } else {
          bp.src = 'http://push.zhanzhang.baidu.com/push.js';
        }
        var s = document.getElementsByTagName('script')[0];
        s.parentNode.insertBefore(bp, s);
      })();
    </script>
  {/if}
</svelte:head>

<JsonLd schema={siteSchema} />
