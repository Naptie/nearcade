<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { getLocale, locales, setLocale } from '$lib/paraglide/runtime';
</script>

<div class="dropdown dropdown-end">
  <div tabindex="0" role="button" class="btn btn-ghost btn-sm lg:btn-md items-center gap-2">
    <i class="fa-solid fa-language fa-lg"></i>
    <span class="not-lg:hidden">{m.name()}</span>
    <i class="fa-solid fa-chevron-down fa-xs"></i>
  </div>
  <ul
    class="dropdown-content menu bg-base-200/50 dark:bg-base-200 rounded-box z-1 w-40 p-2 shadow-lg"
  >
    {#each locales as locale (locale)}
      <li>
        <button
          class="justify-between"
          class:active={getLocale() === locale}
          onclick={() => setLocale(locale)}
        >
          {m.name(undefined, { locale })}
          {#if getLocale() === locale}
            <i class="fa-solid fa-check text-primary"></i>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
</div>
