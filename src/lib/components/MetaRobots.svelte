<script lang="ts">
  interface Props {
    content?: string;
  }

  let { content = 'noindex, nofollow' }: Props = $props();
</script>

<svelte:head>
  <meta name="robots" {content} />
  <meta name="googlebot" {content} />
  <meta name="bingbot" {content} />
  <meta name="baiduspider" {content} />
</svelte:head>
