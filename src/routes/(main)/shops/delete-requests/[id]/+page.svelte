<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { pageTitle } from '$lib/utils';
  import { invalidateAll } from '$app/navigation';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import { fromPath } from '$lib/utils/scoped';

  let { data }: { data: PageData } = $props();

  let req = $derived(data.deleteRequest);
  let reviewNote = $state('');
  let isProcessing = $state(false);
  let processError = $state('');
  let isDeleting = $state(false);

  const handleProcess = async (action: 'approve' | 'reject') => {
    if (isProcessing) return;
    isProcessing = true;
    processError = '';
    try {
      const response = await fetch(fromPath(`/api/shop-delete-requests/${req.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNote: reviewNote.trim() || null })
      });
      if (response.ok) {
        reviewNote = '';
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

  const handleRetract = async () => {
    if (isProcessing) return;
    if (!confirm(m.retract_delete_request_confirm())) return;
    isProcessing = true;
    processError = '';
    try {
      const response = await fetch(fromPath(`/api/shop-delete-requests/${req.id}`), {
        method: 'DELETE'
      });
      if (response.ok) {
        await goto(resolve('/(main)/shops/delete-requests'));
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

  const handleDelete = async () => {
    if (isDeleting) return;
    isDeleting = true;
    processError = '';
    try {
      const response = await fetch(fromPath(`/api/shop-delete-requests/${req.id}`), {
        method: 'DELETE'
      });
      if (response.ok) {
        await goto(resolve('/(main)/shops/delete-requests'));
      } else {
        const err = (await response.json()) as { message?: string };
        processError = err.message || m.error_occurred();
      }
    } catch {
      processError = m.network_error_try_again();
    } finally {
      isDeleting = false;
    }
  };

  const statusBadgeClass = $derived(
    req.status === 'pending'
      ? 'badge-warning'
      : req.status === 'approved'
        ? 'badge-success'
        : 'badge-error'
  );
</script>

<svelte:head>
  <title>{pageTitle(m.shop_delete_request_details(), m.shop_delete_requests())}</title>
</svelte:head>

<div class="mx-auto max-w-2xl px-4 pt-20 pb-12 sm:px-6 lg:px-8">
  <!-- Breadcrumb -->
  <div class="mb-6">
    <a href={resolve('/(main)/shops/delete-requests')} class="btn btn-ghost btn-sm">
      <i class="fa-solid fa-arrow-left"></i>
      {m.shop_delete_requests()}
    </a>
  </div>

  <div class="bg-base-100 border-base-300 rounded-2xl border p-6 shadow-sm">
    <!-- Header -->
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">{m.shop_delete_request_details()}</h1>
        <p class="text-base-content/60 mt-1 font-mono text-sm">{req.id}</p>
      </div>
      <span class="badge {statusBadgeClass} badge-lg">
        {#if req.status === 'pending'}
          {m.shop_delete_request_pending()}
        {:else if req.status === 'approved'}
          {m.shop_delete_request_approved()}
        {:else}
          {m.shop_delete_request_rejected()}
        {/if}
      </span>
    </div>

    <!-- Shop info -->
    <div class="bg-base-200 mb-6 rounded-xl p-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="font-semibold">{req.shopName}</p>
          <p class="text-base-content/60 text-sm">#{req.shopId}</p>
        </div>
        <a
          href={resolve('/(main)/shops/[id]', { id: String(req.shopId) })}
          class="btn btn-ghost btn-sm"
          target="_blank"
          rel="noopener"
        >
          <i class="fa-solid fa-arrow-up-right-from-square"></i>
          {m.view()}
        </a>
      </div>
    </div>

    <!-- Reason -->
    <div class="mb-6">
      <h2 class="mb-2 text-sm font-semibold tracking-wide uppercase opacity-60">
        {m.shop_delete_request_reason()}
      </h2>
      <p class="bg-base-200 rounded-xl p-4 text-sm">{req.reason}</p>
    </div>

    <!-- Metadata -->
    <div class="mb-6 grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <span class="text-base-content/60">{m.request_by()}</span>
        <p class="font-medium">{req.requestedByName ?? m.anonymous_user()}</p>
      </div>
      <div>
        <span class="text-base-content/60">{m.created_at()}</span>
        <p class="font-medium">{new Date(req.createdAt).toLocaleString()}</p>
      </div>
    </div>

    <!-- Review details -->
    {#if req.reviewedAt}
      <div class="border-base-300 mb-6 border-t pt-6">
        <h2 class="mb-3 text-sm font-semibold tracking-wide uppercase opacity-60">
          {m.details()}
        </h2>
        <div class="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <span class="text-base-content/60"
              >{m.reviewed_at({ time: new Date(req.reviewedAt).toLocaleString() })}</span
            >
          </div>
          {#if req.reviewNote}
            <div>
              <span class="text-base-content/60">{m.shop_delete_request_review_note()}</span>
              <p class="font-medium">{req.reviewNote}</p>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if processError}
      <div class="alert alert-error alert-soft mb-4">
        <i class="fa-solid fa-exclamation-triangle"></i>
        <span>{processError}</span>
      </div>
    {/if}

    <!-- Actions -->
    {#if req.status === 'pending'}
      <div class="border-base-300 border-t pt-6">
        <!-- Requester: retract -->
        {#if data.user?.id === req.requestedBy}
          <button
            class="btn btn-warning btn-soft w-full"
            onclick={handleRetract}
            disabled={isProcessing}
          >
            {#if isProcessing}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              <i class="fa-solid fa-rotate-left"></i>
            {/if}
            {m.retract_delete_request()}
          </button>
        {/if}

        <!-- Admin: approve/reject/delete -->
        {#if data.user?.userType === 'site_admin'}
          <div class="space-y-3">
            <input
              type="text"
              class="input input-bordered w-full"
              placeholder={m.shop_delete_request_review_note()}
              bind:value={reviewNote}
              disabled={isProcessing}
            />
            <div class="flex gap-3">
              <button
                class="btn btn-success flex-1"
                onclick={() => handleProcess('approve')}
                disabled={isProcessing}
              >
                {#if isProcessing}
                  <span class="loading loading-spinner loading-xs"></span>
                {:else}
                  <i class="fa-solid fa-check"></i>
                {/if}
                {m.admin_approve()}
              </button>
              <button
                class="btn btn-error flex-1"
                onclick={() => handleProcess('reject')}
                disabled={isProcessing}
              >
                {#if isProcessing}
                  <span class="loading loading-spinner loading-xs"></span>
                {:else}
                  <i class="fa-solid fa-xmark"></i>
                {/if}
                {m.admin_reject()}
              </button>
            </div>
            <button class="btn btn-ghost w-full" onclick={handleDelete} disabled={isDeleting}>
              {#if isDeleting}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                <i class="fa-solid fa-trash"></i>
              {/if}
              {m.delete_this_request()}
            </button>
          </div>
        {/if}
      </div>
    {:else if data.user?.userType === 'site_admin'}
      <div class="border-base-300 border-t pt-6">
        <button class="btn btn-ghost" onclick={handleDelete} disabled={isDeleting}>
          {#if isDeleting}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            <i class="fa-solid fa-trash"></i>
          {/if}
          {m.delete_this_request()}
        </button>
      </div>
    {/if}
  </div>
</div>
