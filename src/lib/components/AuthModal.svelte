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

  const providers = [
    { name: 'GitHub', icon: 'fa-github' },
    { name: 'Microsoft', id: 'microsoft-entra-id', icon: 'fa-microsoft' },
    {
      name: 'Discord',
      icon: 'fa-discord',
      class: 'hover:bg-[#5865F2] hover:text-white'
    },
    {
      name: 'osu!',
      icon: 'osu.svg',
      class: 'hover:bg-[#DA5892] hover:text-white'
    }
  ];

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
        <div class="grid grid-cols-1 gap-4 px-4 md:grid-cols-2">
          {#each providers as provider (provider.name)}
            {@const providerId = provider.id || provider.name.toLowerCase().replace(/[^a-z]/g, '')}
            <form method="POST" action="/session/signin">
              <input type="hidden" name="providerId" value={providerId} />
              <button
                type="submit"
                class="btn btn-outline not-2xs:btn-circle w-full items-center gap-2 py-5 sm:px-6 {provider.class
                  ? provider.class
                  : 'hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black'}"
              >
                {#if provider.icon.startsWith('fa-')}
                  <i class="fa-brands fa-lg {provider.icon}"></i>
                {:else}
                  <img src="{base}/{provider.icon}" alt="{provider.name} Logo" class="h-5 w-5" />
                {/if}
                <p class="not-sm:hidden">{m.sign_in_with({ provider: provider.name })}</p>
                <p class="not-2xs:hidden sm:hidden">{provider.name}</p>
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

<style>
  .not-2xs\:hidden {
    @media not (width >= 18rem) {
      display: none;
    }
  }

  .not-2xs\:btn-circle {
    @media not (width >= 18rem) {
      border-radius: calc(infinity * 1px);
      padding-inline: 0;
      width: var(--size);
      height: var(--size);
    }
  }
</style>
