<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { resolve } from '$app/paths';
  import { pageTitle } from '$lib/utils';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let reviewNotes = $state<Record<string, string>>({});
</script>

<svelte:head>
  <title>{pageTitle(m.admin_shop_delete_requests(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div>
      <h1 class="text-3xl font-bold">{m.admin_shop_delete_requests()}</h1>
      <p class="text-base-content/60">{m.admin_shop_delete_requests_description()}</p>
    </div>
  </div>

  <!-- Status filter -->
  <div class="flex gap-2">
    {#each ['pending', 'approved', 'rejected', 'all'] as s (s)}
      <a
        href="{resolve('/admin/shop-delete-requests')}?status={s}"
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
    <div class="bg-base-100 border-base-300 rounded-lg border p-12 text-center shadow-sm">
      <i class="fa-solid fa-inbox text-base-content/30 mb-4 text-4xl"></i>
      <p class="text-base-content/60">{m.no_delete_requests()}</p>
    </div>
  {:else}
    <div class="space-y-4">
      {#each data.requests as req (req.id)}
        <div class="bg-base-100 border-base-300 rounded-lg border p-5 shadow-sm">
          <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-semibold">{req.shopName}</p>
              <p class="text-base-content/60 text-sm">
                {req.shopSource}/{req.shopId}
                &nbsp;·&nbsp;
                <a
                  href={resolve('/(main)/shops/[source]/[id]', {
                    source: req.shopSource,
                    id: String(req.shopId)
                  })}
                  class="link"
                  target="_blank"
                  rel="noopener"
                >
                  {m.view()}
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

          <div class="bg-base-200 mb-3 rounded p-3">
            <p class="text-sm font-medium">{m.shop_delete_request_reason()}:</p>
            <p class="text-sm">{req.reason}</p>
          </div>

          <p class="text-base-content/60 mb-3 text-xs">
            {m.request_by()}: {req.requestedByName ?? m.anonymous_user()}
            &nbsp;·&nbsp;
            {new Date(req.createdAt).toLocaleString()}
          </p>

          {#if req.reviewNote}
            <p class="text-base-content/60 mb-3 text-xs">
              {m.shop_delete_request_review_note()}: {req.reviewNote}
            </p>
          {/if}

          {#if req.status === 'pending'}
            <div class="border-base-300 flex flex-col gap-2 border-t pt-3">
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                placeholder={m.shop_delete_request_review_note()}
                bind:value={reviewNotes[req.id]}
              />
              <div class="flex gap-2">
                <form method="POST" action="?/approve" use:enhance>
                  <input type="hidden" name="requestId" value={req.id} />
                  <input type="hidden" name="reviewNote" value={reviewNotes[req.id] ?? ''} />
                  <button type="submit" class="btn btn-success btn-sm">
                    <i class="fa-solid fa-check"></i>
                    {m.admin_approve()}
                  </button>
                </form>
                <form method="POST" action="?/reject" use:enhance>
                  <input type="hidden" name="requestId" value={req.id} />
                  <input type="hidden" name="reviewNote" value={reviewNotes[req.id] ?? ''} />
                  <button type="submit" class="btn btn-error btn-sm">
                    <i class="fa-solid fa-xmark"></i>
                    {m.admin_reject()}
                  </button>
                </form>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
