<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { fromPath } from '$lib/utils/scoped';
  import { getDisplayName } from '$lib/utils';
  import type { User } from '$lib/auth/types';

  /** The pending delete request as serialized to the page. */
  interface PendingDeleteRequest {
    id: string;
    reason: string;
    requestedBy?: string | null;
    requestedByName?: string | null;
    createdAt: string | Date;
    requestedByUser?: {
      id?: string;
      name?: string | null;
      displayName?: string | null;
      image?: string | null;
    } | null;
  }

  interface Props {
    request: PendingDeleteRequest;
    user: User | undefined;
    canProtectedShopAction: boolean;
    protectedShopActionMessage?: string;
  }

  let { request, user, canProtectedShopAction, protectedShopActionMessage }: Props = $props();

  let reviewNote = $state('');
  let isProcessing = $state(false);
  let processError = $state('');

  const profileLinkClass =
    'underline decoration-transparent decoration-1 underline-offset-3 transition-colors hover:text-white hover:decoration-white';

  const profileHref = (user?: { id?: string | null; name?: string | null } | null) =>
    user?.id ? resolve('/(main)/users/[id]', { id: user.name ? '@' + user.name : user.id }) : '#';

  const handleRetract = async () => {
    if (!canProtectedShopAction || isProcessing) return;
    if (!confirm(m.retract_delete_request_confirm())) return;
    isProcessing = true;
    processError = '';
    try {
      const response = await fetch(fromPath(`/api/shops/delete-requests/${request.id}`), {
        method: 'DELETE'
      });
      if (response.ok) {
        invalidateAll();
      } else {
        const err = (await response.json()) as { message?: string };
        processError = err.message || m.error_occurred();
      }
    } catch {
      processError = m.network_error_try_again();
    } finally {
      isProcessing = false;
    }
  };

  const handleProcess = async (action: 'approve' | 'reject') => {
    if (!canProtectedShopAction || user?.userType !== 'site_admin' || isProcessing) return;
    isProcessing = true;
    processError = '';
    try {
      const response = await fetch(fromPath(`/api/shops/delete-requests/${request.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNote: reviewNote.trim() || null })
      });
      if (response.ok) {
        reviewNote = '';
        await goto(resolve('/(main)/shops/delete-requests/[id]', { id: request.id }));
      } else {
        const err = (await response.json()) as { message?: string };
        processError = err.message || m.error_occurred();
      }
    } catch {
      processError = m.network_error_try_again();
    } finally {
      isProcessing = false;
    }
  };
</script>

<div class="card border-warning/40 bg-warning/5 border">
  <div class="card-body p-6">
    <h3 class="text-warning mb-3 flex items-center gap-2 text-lg font-semibold">
      <i class="fa-solid fa-triangle-exclamation"></i>
      {m.pending_delete_request()}
    </h3>

    <div class="space-y-2 text-sm">
      <div>
        <span class="text-base-content/60">{m.shop_delete_request_reason()}:</span>
        <p class="mt-1 font-medium break-all">{request.reason}</p>
      </div>
      <div class="flex items-center justify-between gap-1">
        <span class="text-base-content/60">{m.request_by()}:</span>
        <span class="text-right font-medium">
          {#if request.requestedByUser}
            <a href={profileHref(request.requestedByUser)} class={profileLinkClass}>
              {getDisplayName(request.requestedByUser)}
            </a>
          {:else}
            {request.requestedByName ?? m.unknown_user()}
          {/if}
        </span>
      </div>
      <div class="flex items-center justify-between gap-1">
        <span class="text-base-content/60">{m.created_at()}:</span>
        <span class="text-right font-medium">
          {new Date(request.createdAt).toLocaleDateString()}
        </span>
      </div>
    </div>

    {#if processError}
      <div class="alert alert-error alert-soft mt-3 py-2 text-sm">
        {processError}
      </div>
    {/if}

    <div class="mt-3 space-y-2">
      <!-- Requester: retract button -->
      {#if user?.id === request.requestedBy}
        <button
          class="btn btn-warning btn-soft btn-sm w-full"
          onclick={handleRetract}
          disabled={!canProtectedShopAction || isProcessing}
          title={!canProtectedShopAction ? protectedShopActionMessage : undefined}
        >
          {#if isProcessing}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            <i class="fa-solid fa-rotate-left"></i>
          {/if}
          {m.retract_delete_request()}
        </button>
      {/if}

      <!-- Admin: approve/reject with review note -->
      {#if user?.userType === 'site_admin'}
        <input
          type="text"
          class="input input-bordered input-sm w-full"
          placeholder={m.shop_delete_request_review_note()}
          bind:value={reviewNote}
          disabled={!canProtectedShopAction || isProcessing}
        />
        <div class="flex gap-2">
          <button
            class="btn btn-success btn-sm flex-1"
            onclick={() => handleProcess('approve')}
            disabled={!canProtectedShopAction || isProcessing}
          >
            {#if isProcessing}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              <i class="fa-solid fa-check"></i>
            {/if}
            {m.admin_approve()}
          </button>
          <button
            class="btn btn-error btn-sm flex-1"
            onclick={() => handleProcess('reject')}
            disabled={!canProtectedShopAction || isProcessing}
          >
            {#if isProcessing}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              <i class="fa-solid fa-xmark"></i>
            {/if}
            {m.admin_reject()}
          </button>
        </div>
      {/if}

      <a
        href={resolve('/(main)/shops/delete-requests/[id]', { id: request.id })}
        class="btn btn-ghost btn-sm w-full"
      >
        <i class="fa-solid fa-arrow-up-right-from-square"></i>
        {m.view_delete_request()}
      </a>
    </div>
  </div>
</div>
