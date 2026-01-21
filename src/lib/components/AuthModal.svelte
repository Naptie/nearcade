<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import FancyButton from './FancyButton.svelte';
  import { page } from '$app/state';
  import { signOut } from '@auth/sveltekit/client';
  import { resolve, base } from '$app/paths';
  import { getDisplayName, isAdminOrModerator, getProviders } from '$lib/utils';
  import { onMount } from 'svelte';

  interface Props {
    size?: string;
    class?: string;
    btnCls?: string;
  }

  let { size = 'lg', class: klass = '', btnCls }: Props = $props();

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

  const login = () => {
    dialogElement?.showModal();
  };

  onMount(() => {
    window.addEventListener('nearcade-login', login);

    return () => {
      window.removeEventListener('nearcade-login', login);
    };
  });

  $effect(() => {
    if (page.url.searchParams.get('login') === '1') {
      login();
    }
  });
</script>

{#if !session || !session.user || session.expires < new Date().toISOString()}
  <FancyButton
    callback={() => {
      dialogElement?.showModal();
    }}
    class="fa-solid fa-user fa-{size} {klass}"
    {btnCls}
    text={m.sign_in()}
    stayExpandedOnWideScreens
  />

  <dialog
    bind:this={dialogElement}
    class="modal"
    onclick={handleDialogClick}
    onkeydown={handleKeydown}
  >
    <div class="text-base-content modal-box relative max-h-[90vh] max-w-xl">
      <button
        class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2"
        onclick={() => {
          dialogElement?.close();
        }}
        aria-label={m.close_modal()}
      >
        <i class="fa-solid fa-xmark fa-lg"></i>
      </button>

      <div class="text-center">
        <h3 class="mb-4 text-lg font-bold">{m.sign_in()}</h3>
        <div class="grid grid-cols-1 gap-4 px-4 md:grid-cols-2">
          {#each getProviders() as provider (provider.id)}
            <form method="POST" action={resolve('/session/signin')}>
              <input type="hidden" name="providerId" value={provider.id} />
              <button
                type="submit"
                class="btn btn-outline not-2xs:btn-circle btn-t w-full items-center gap-2 py-5 sm:px-6 {provider.class}"
              >
                {#if provider.icon.startsWith('fa-')}
                  <i class="fa-brands fa-lg {provider.icon}"></i>
                {:else}
                  <img
                    src="{base}/{provider.icon}"
                    alt="{provider.name} {m.provider_logo()}"
                    class="h-5 w-5 rounded-full"
                  />
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
    <div class="indicator group">
      {#if session.pendingJoinRequests && session.pendingJoinRequests > 0}
        <span
          class="indicator-item status status-warning top-1.5 right-1.5 z-10 transition-opacity group-hover:opacity-0"
        ></span>
      {:else if session.unreadNotifications > 0}
        <span
          class="indicator-item status status-success top-1.5 right-1.5 z-10 transition-opacity group-hover:opacity-0"
        ></span>
      {/if}
      <FancyButton
        class="rounded-full {klass}"
        image={session.user?.image || ''}
        text={getDisplayName(session.user)}
        callback={() => {
          open = !open;
        }}
        stayExpandedOnWideScreens
      />
    </div>
    {#if open}
      <ul
        class="text-base-content dropdown-content menu bg-base-200 rounded-box z-1 min-w-40 p-2 shadow-lg"
      >
        <li>
          <a
            href={resolve('/(main)/users/[id]', { id: '@' + session.user.name })}
            class="flex items-center gap-2"
          >
            <i class="fa-solid fa-user"></i>
            {m.my_profile()}
          </a>
          {#if isAdminOrModerator(session.user)}
            <a href={resolve('/admin')} class="group flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <i class="fa-solid fa-shield-halved"></i>
                {m.admin_panel()}
              </div>
              {#if session.pendingJoinRequests && session.pendingJoinRequests > 0}
                <span
                  class="badge badge-sm dark:not-group-hover:badge-soft badge-warning transition-colors"
                >
                  {session.pendingJoinRequests}
                </span>
              {/if}
            </a>
          {/if}
          <a
            href={resolve('/(main)/notifications')}
            class="group flex items-center justify-between gap-2"
          >
            <div class="flex items-center gap-2">
              <i class="fa-solid fa-bell"></i>
              {m.notifications()}
            </div>
            {#if session.unreadNotifications > 0}
              <span
                class="badge badge-sm dark:not-group-hover:badge-soft badge-primary transition-colors"
              >
                {session.unreadNotifications}
              </span>
            {/if}
          </a>
          <a href={resolve('/(main)/settings')} class="flex items-center gap-2">
            <i class="fa-solid fa-gear"></i>
            {m.settings()}
          </a>
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
  .btn-t {
    transition-property:
      color, background-color, border-color, box-shadow, --tw-gradient-from, --tw-gradient-via,
      --tw-gradient-to;
    transition-timing-function: cubic-bezier(0, 0, 0.2, 1);
    transition-duration: 0.2s;
  }
</style>
