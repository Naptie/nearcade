<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import FancyButton from './FancyButton.svelte';
  import { page } from '$app/state';
  import { signOut } from '@auth/sveltekit/client';
  import { base } from '$app/paths';

  interface Props {
    size?: string;
  }

  let { size = 'lg' }: Props = $props();

  let session = $derived(page.data.session);
  let open = $state(false);
  let dialogElement: HTMLDialogElement | undefined = $state(undefined);

  // Close modal when clicking backdrop
  const handleDialogClick = (event: MouseEvent) => {
    if (event.target === dialogElement) {
      dialogElement.close();
    }
  };

  // Close modal on Escape key
  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      dialogElement?.close();
    }
  };
</script>

{#if !session || !session.user || session.expires < new Date().toISOString()}
  <FancyButton
    callback={() => {
      dialogElement?.showModal();
    }}
    class="fa-solid fa-user fa-{size}"
    text={m.sign_in()}
  />

  <dialog
    bind:this={dialogElement}
    class="modal"
    onclick={handleDialogClick}
    onkeydown={handleKeydown}
  >
    <div class="modal-box relative max-h-[90vh] max-w-xl">
      <button
        class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2"
        onclick={() => {
          dialogElement?.close();
        }}
        aria-label="Close modal"
      >
        <i class="fa-solid fa-xmark fa-lg"></i>
      </button>

      <div class="text-center">
        <h3 class="mb-4 text-lg font-bold">{m.sign_in()}</h3>
        <div class="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2">
          {#each [{ name: 'GitHub', icon: 'fa-github' }, { name: 'osu!', icon: 'osu.svg', class: 'hover:bg-[#DA5892]' }] as provider (provider.name)}
            {@const providerId = provider.name.toLowerCase().replace(/[^a-z]/g, '')}
            <form method="POST" action="/session/signin">
              <input type="hidden" name="providerId" value={providerId} />
              <button
                type="submit"
                class="btn btn-outline hover:text-primary-content w-full items-center gap-2 py-5 sm:px-6 dark:hover:text-black {provider.class
                  ? provider.class
                  : 'hover:bg-primary dark:hover:bg-white'}"
              >
                {#if provider.icon.startsWith('fa-')}
                  <i class="fa-brands fa-lg {provider.icon}"></i>
                {:else}
                  <img src="{base}/{provider.icon}" alt="{provider.name} Logo" class="h-5 w-5" />
                {/if}
                <p class="not-md:hidden">{m.sign_in_with({ provider: provider.name })}</p>
                <p class="hidden not-md:block">{provider.name}</p>
              </button>
            </form>
          {/each}
        </div>
      </div>
    </div>
  </dialog>
{:else}
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
    <FancyButton
      class="rounded-full"
      image={session.user?.image || ''}
      text={session.user.name || ''}
      callback={() => {
        open = !open;
      }}
    />
    {#if open}
      <ul class="dropdown-content menu bg-base-200 rounded-box z-1 w-40 p-2 shadow-lg">
        <li>
          <button
            class="inline-flex items-center gap-2"
            onclick={() => {
              signOut();
              open = false;
            }}
          >
            <i class="fa-solid fa-arrow-right-from-bracket"></i>
            {m.sign_out()}
          </button>
        </li>
      </ul>
    {/if}
  </div>
{/if}
