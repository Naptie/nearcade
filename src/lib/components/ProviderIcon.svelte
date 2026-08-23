<script lang="ts">
  import { base } from '$app/paths';

  let {
    icon,
    name,
    class: iconClass = '',
    imgClass = 'h-7 w-7 rounded-full'
  }: {
    icon: string | undefined;
    name: string;
    class?: string;
    imgClass?: string;
  } = $props();

  const isFontAwesome = $derived(icon && icon.startsWith('fa-'));
  const faClass = $derived(isFontAwesome ? (icon ? `fa-brands ${icon}` : 'fa-solid fa-link') : '');
</script>

{#if isFontAwesome}
  <i class="{iconClass} {faClass}"></i>
{:else}
  <img src="{base}/{icon}" alt={name} class="{imgClass} {iconClass}" />
{/if}
