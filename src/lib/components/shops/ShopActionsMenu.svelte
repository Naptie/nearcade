<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { invalidateAll } from '$app/navigation';
  import { fromPath } from '$lib/utils/scoped';
  import { phoneRequiredToast } from '$lib/notifications/phone-required';
  import type { Shop } from '$lib/types';
  import type { User } from '$lib/auth/types';

  interface Props {
    shop: Shop;
    user: User;
    canProtectedShopAction: boolean;
    protectedShopActionMessage?: string;
    isPhoneRequired: boolean;
    hasPendingDeleteRequest: boolean;
    /** Opens the delete-request modal owned by the page. */
    onRequestDelete: () => void;
  }

  let {
    shop,
    user,
    canProtectedShopAction,
    protectedShopActionMessage,
    isPhoneRequired,
    hasPendingDeleteRequest,
    onRequestDelete
  }: Props = $props();

  let isAdmin = $derived(user.userType === 'site_admin');
  let isTogglingLock = $state(false);

  const handleToggleLock = async () => {
    if (!isAdmin || isTogglingLock) return;
    isTogglingLock = true;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked: !shop.isLocked })
      });
      if (response.ok) {
        await invalidateAll();
      } else {
        const err = (await response.json()) as { message?: string };
        alert(err.message || m.error_occurred());
      }
    } catch {
      alert(m.network_error_try_again());
    } finally {
      isTogglingLock = false;
    }
  };
</script>

<!-- Three-dots dropdown for shop actions -->
<div class="dropdown lg:dropdown-end">
  <button
    type="button"
    tabindex="0"
    class="btn btn-circle btn-soft"
    aria-label={m.more_actions()}
    title={m.more_actions()}
  >
    <i class="fa-solid fa-ellipsis"></i>
  </button>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <ul tabindex="0" class="dropdown-content menu bg-base-200 rounded-box z-10 w-52 p-2 shadow">
    <li>
      {#if canProtectedShopAction}
        <a href={resolve('/(main)/shops/[id]/edit', { id: String(shop.id) })}>
          <i class="fa-solid fa-pen-to-square"></i>
          {m.edit_shop()}
        </a>
      {:else if isPhoneRequired}
        <button onclick={() => phoneRequiredToast()}>
          <i class="fa-solid fa-pen-to-square"></i>
          {m.edit_shop()}
        </button>
      {:else}
        <button
          disabled
          class:opacity-50={!canProtectedShopAction}
          class:cursor-not-allowed={!canProtectedShopAction}
          title={protectedShopActionMessage}
        >
          <i class="fa-solid fa-pen-to-square"></i>
          {m.edit_shop()}
        </button>
      {/if}
    </li>
    <li>
      <button
        onclick={() => {
          if (hasPendingDeleteRequest) return;
          if (!canProtectedShopAction) {
            if (isPhoneRequired) phoneRequiredToast();
            return;
          }
          onRequestDelete();
        }}
        disabled={(!canProtectedShopAction && !isPhoneRequired) || hasPendingDeleteRequest}
        class:opacity-50={(!canProtectedShopAction && !isPhoneRequired) || hasPendingDeleteRequest}
        class:cursor-not-allowed={(!canProtectedShopAction && !isPhoneRequired) ||
          hasPendingDeleteRequest}
        title={hasPendingDeleteRequest
          ? m.shop_delete_request_already_pending()
          : !canProtectedShopAction && !isPhoneRequired
            ? protectedShopActionMessage
            : undefined}
      >
        <i class="fa-solid fa-trash-can"></i>
        {m.request_delete_shop()}
      </button>
    </li>
    {#if isAdmin}
      <li>
        <button
          onclick={handleToggleLock}
          disabled={isTogglingLock}
          class:opacity-50={isTogglingLock}
        >
          {#if isTogglingLock}
            <span class="loading loading-spinner loading-xs"></span>
          {:else if shop.isLocked}
            <i class="fa-solid fa-lock-open"></i>
          {:else}
            <i class="fa-solid fa-lock"></i>
          {/if}
          {shop.isLocked ? m.shop_unlock() : m.shop_lock()}
        </button>
      </li>
    {/if}
  </ul>
</div>
