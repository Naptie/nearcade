<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { pageTitle } from '$lib/utils';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import { fromPath } from '$lib/utils/scoped';

  let { data }: { data: PageData } = $props();

  let reviewNotes = $state<Record<string, string>>({});
  let isProcessing = $state<Record<string, boolean>>({});
  let processErrors = $state<Record<string, string>>({});
  let isDeletingRequest = $state<Record<string, boolean>>({});

  const handleProcess = async (requestId: string, action: 'approve' | 'reject') => {
    if (isProcessing[requestId]) return;
    isProcessing[requestId] = true;
    processErrors[requestId] = '';
    try {
      const response = await fetch(fromPath(`/api/shop-delete-requests/${requestId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNote: reviewNotes[requestId]?.trim() || null })
      });
      if (response.ok) {
        reviewNotes[requestId] = '';
        invalidateAll();
      } else {
        const err = (await response.json()) as { message?: string };
        processErrors[requestId] = err.message || m.error_occurred();
      }
    } catch {
      processErrors[requestId] = m.network_error_try_again();
    } finally {
      isProcessing[requestId] = false;
    }
  };

  const handleDeleteRequest = async (requestId: string) => {
    if (isDeletingRequest[requestId]) return;
    isDeletingRequest[requestId] = true;
    processErrors[requestId] = '';
    try {
      const response = await fetch(fromPath(`/api/shop-delete-requests/${requestId}`), {
        method: 'DELETE'
      });
      if (response.ok) {
        invalidateAll();
      } else {
        const err = (await response.json()) as { message?: string };
        processErrors[requestId] = err.message || m.error_occurred();
      }
    } catch {
      processErrors[requestId] = m.network_error_try_again();
    } finally {
      isDeletingRequest[requestId] = false;
    }
  };
</script>

<svelte:head>
  <title>{pageTitle(m.shop_delete_requests())}</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 pt-20 pb-12 sm:px-6 lg:px-8">
  <!-- Header -->
  <div class="mb-8 flex items-center justify-between gap-4">
    <div>
      <h1 class="text-3xl font-bold">{m.shop_delete_requests()}</h1>
      <p class="text-base-content/60 mt-1">{m.shop_delete_requests_description()}</p>
    </div>
  </div>

  <!-- Status filter -->
  <div class="mb-6 flex flex-wrap gap-2">
    {#each ['pending', 'approved', 'rejected', 'all'] as s (s)}
      <a
        href="{resolve('/(main)/shops/delete-requests')}?status={s}"
        class="btn btn-sm {data.currentStatus === s ? 'btn-primary' : 'btn-ghost'}"
      >
        {#if s === 'pending'}
          {m.shop_delete_request_pending()}
        {:else if s === 'approved'}
          {m.shop_delete_request_approved()}
        {:else if s === 'rejected'}
          {m.shop_delete_request_rejected()}
        {:else}
          {m.admin_all_statuses()}
        {/if}
      </a>
    {/each}
  </div>

  {#if data.requests.length === 0}
    <div class="bg-base-100 border-base-300 rounded-2xl border p-12 text-center shadow-sm">
      <i class="fa-solid fa-inbox text-base-content/30 mb-4 text-4xl"></i>
      <p class="text-base-content/60">{m.no_delete_requests()}</p>
    </div>
  {:else}
    <div class="space-y-4">
      {#each data.requests as req (req.id)}
        <div class="bg-base-100 border-base-300 rounded-2xl border p-5 shadow-sm">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-semibold">{req.shopName}</p>
              <p class="text-base-content/60 text-sm">
                #{req.shopId}
                &nbsp;·&nbsp;
                <a
                  href={resolve('/(main)/shops/[id]', { id: String(req.shopId) })}
                  class="link"
                  target="_blank"
                  rel="noopener"
                >
                  {m.view()}
                </a>
                &nbsp;·&nbsp;
                <a
                  href={resolve('/(main)/shops/delete-requests/[id]', { id: req.id })}
                  class="link"
                >
                  {m.view_delete_request()}
                </a>
              </p>
            </div>
            <span
              class="badge {req.status === 'pending'
                ? 'badge-warning'
                : req.status === 'approved'
                  ? 'badge-success'
                  : 'badge-error'}"
            >
              {#if req.status === 'pending'}
                {m.shop_delete_request_pending()}
              {:else if req.status === 'approved'}
                {m.shop_delete_request_approved()}
              {:else}
                {m.shop_delete_request_rejected()}
              {/if}
            </span>
          </div>

          <div class="bg-base-200 mb-3 rounded-lg p-3">
            <p class="text-sm font-medium">{m.shop_delete_request_reason()}:</p>
            <p class="text-sm">{req.reason}</p>
          </div>

          <p class="text-base-content/60 mb-1 text-xs">
            {m.request_by()}: {req.requestedByName ?? m.anonymous_user()}
            &nbsp;·&nbsp;
            {new Date(req.createdAt).toLocaleString()}
          </p>

          {#if req.reviewNote}
            <p class="text-base-content/60 mb-1 text-xs">
              {m.shop_delete_request_review_note()}: {req.reviewNote}
            </p>
          {/if}

          {#if processErrors[req.id]}
            <div class="alert alert-error alert-soft mt-2 py-2 text-sm">
              {processErrors[req.id]}
            </div>
          {/if}

          <!-- Admin actions -->
          {#if data.user?.userType === 'site_admin'}
            {#if req.status === 'pending'}
              <div class="border-base-300 mt-3 flex flex-col gap-2 border-t pt-3">
                <input
                  type="text"
                  class="input input-bordered input-sm w-full"
                  placeholder={m.shop_delete_request_review_note()}
                  bind:value={reviewNotes[req.id]}
                />
                <div class="flex flex-wrap gap-2">
                  <button
                    class="btn btn-success btn-sm"
                    onclick={() => handleProcess(req.id, 'approve')}
                    disabled={isProcessing[req.id]}
                  >
                    {#if isProcessing[req.id]}
                      <span class="loading loading-spinner loading-xs"></span>
                    {:else}
                      <i class="fa-solid fa-check"></i>
                    {/if}
                    {m.admin_approve()}
                  </button>
                  <button
                    class="btn btn-error btn-sm"
                    onclick={() => handleProcess(req.id, 'reject')}
                    disabled={isProcessing[req.id]}
                  >
                    {#if isProcessing[req.id]}
                      <span class="loading loading-spinner loading-xs"></span>
                    {:else}
                      <i class="fa-solid fa-xmark"></i>
                    {/if}
                    {m.admin_reject()}
                  </button>
                  <button
                    class="btn btn-ghost btn-sm"
                    onclick={() => handleDeleteRequest(req.id)}
                    disabled={isDeletingRequest[req.id]}
                  >
                    {#if isDeletingRequest[req.id]}
                      <span class="loading loading-spinner loading-xs"></span>
                    {:else}
                      <i class="fa-solid fa-trash"></i>
                    {/if}
                    {m.delete_this_request()}
                  </button>
                </div>
              </div>
            {:else}
              <div class="border-base-300 mt-3 border-t pt-3">
                <button
                  class="btn btn-ghost btn-sm"
                  onclick={() => handleDeleteRequest(req.id)}
                  disabled={isDeletingRequest[req.id]}
                >
                  {#if isDeletingRequest[req.id]}
                    <span class="loading loading-spinner loading-xs"></span>
                  {:else}
                    <i class="fa-solid fa-trash"></i>
                  {/if}
                  {m.delete_this_request()}
                </button>
              </div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
