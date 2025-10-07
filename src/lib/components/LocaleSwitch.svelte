<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { getLocale, locales, setLocale } from '$lib/paraglide/runtime';
  import FancyButton from './FancyButton.svelte';

  let { class: klass = '' } = $props();

  let open = $state(false);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="dropdown dropdown-end"
  tabindex="0"
  onblur={(event: FocusEvent) => {
    // Only close if focus moves outside the dropdown
    if (!(event.currentTarget as Node)?.contains(event.relatedTarget as Node)) {
      open = false;
    }
  }}
>
  {#snippet content()}
    <div class="flex items-center gap-2">
      <span>{m.locale_name()}</span>
      <i
        class="fa-solid fa-chevron-down fa-xs transition-transform ease-out"
        class:rotate-180={open}
      ></i>
    </div>
  {/snippet}
  <FancyButton
    class="fa-solid fa-language fa-lg {klass}"
    btnCls="btn-ghost btn-sm lg:btn-md gap-2"
    {content}
    callback={() => {
      open = !open;
    }}
    stayExpandedOnWideScreens
  />
  {#if open}
    <ul class="dropdown-content menu bg-base-200 rounded-box z-1 w-40 p-2 shadow-lg">
      {#each locales as locale (locale)}
        <li>
          <button
            class="justify-between"
            class:active={getLocale() === locale}
            onclick={() => {
              setLocale(locale);
              open = false;
            }}
          >
            {m.locale_name(undefined, { locale })}
            {#if getLocale() === locale}
              <i class="fa-solid fa-check text-primary"></i>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
