<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import type { PageData } from './$types';
  import type { JoinRequestWithUser } from '$lib/types';
  import { formatDateTime } from '$lib/utils';

  let { data }: { data: PageData } = $props();

  let showReviewModal = $state(false);
  let reviewAction = $state('');
  let selectedRequest = $state<
    | (JoinRequestWithUser & {
        target: Record<string, unknown> | null;
      })
    | null
  >(null);
  let reviewNote = $state('');
  let isSubmitting = $state(false);

  const statusLabelMap = {
    pending: m.admin_pending(),
    approved: m.admin_approved(),
    rejected: m.admin_rejected()
  };

  const openReviewModal = (
    action: string,
    request:
      | (JoinRequestWithUser & {
          target: Record<string, unknown> | null;
        })
      | null
  ) => {
    reviewAction = action;
    selectedRequest = request;
    reviewNote = '';
    showReviewModal = true;
  };

  const closeReviewModal = () => {
    showReviewModal = false;
    reviewAction = '';
    selectedRequest = null;
    reviewNote = '';
  };

  const updateFilters = (newFilters: Record<string, string>) => {
    const url = new URL(page.url);
    Object.entries(newFilters).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    goto(url.toString());
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'pending':
        return 'badge-warning';
      case 'approved':
        return 'badge-success';
      case 'rejected':
        return 'badge-error';
      default:
        return 'badge-neutral';
    }
  };
</script>

<svelte:head>
  <title>{m.join_requests()} - {m.admin_panel()} - {m.app_name()}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <!-- Page Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-base-content text-3xl font-bold">{m.join_requests()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_review_manage_requests()}</p>
    </div>
  </div>

  <!-- Filters -->
  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <div class="flex flex-nowrap gap-4">
      <div class="form-control flex-1">
        <label class="label" for="status-filter">
          <span class="label-text font-medium">{m.admin_status()}</span>
        </label>
        <select
          id="status-filter"
          class="select select-bordered w-full"
          value={data.filters?.status || 'pending'}
          onchange={(e) => updateFilters({ status: (e.target as HTMLSelectElement).value })}
        >
          <option value="all">{m.admin_all_statuses()}</option>
          <option value="pending">{m.admin_pending()}</option>
          <option value="approved">{m.admin_approved()}</option>
          <option value="rejected">{m.admin_rejected()}</option>
        </select>
      </div>

      <div class="form-control flex-1">
        <label class="label" for="type-filter">
          <span class="label-text font-medium">{m.admin_type()}</span>
        </label>
        <select
          id="type-filter"
          class="select select-bordered w-full"
          value={data.filters?.type || 'all'}
          onchange={(e) => updateFilters({ type: (e.target as HTMLSelectElement).value })}
        >
          <option value="all">{m.admin_all_types()}</option>
          <option value="university">{m.admin_universities_option()}</option>
          <option value="club">{m.admin_clubs_option()}</option>
        </select>
      </div>
    </div>
  </div>

  <!-- Join Requests List -->
  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if data.joinRequests && data.joinRequests.length > 0}
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{m.admin_user_header()}</th>
              <th>{m.admin_target_header()}</th>
              <th class="not-md:hidden">{m.admin_message_header()}</th>
              <th class="not-md:hidden">{m.admin_created_header()}</th>
              <th>{m.admin_status_header()}</th>
              <th class="not-lg:hidden">{m.admin_review_note_header()}</th>
              <th class="not-sm:hidden">{m.admin_reviewer_header()}</th>
              <th class="text-right">{m.admin_actions_header()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.joinRequests as request (request.id)}
              <tr class="hover">
                <td class="max-w-[10vw]">
                  <div class="flex items-center gap-3">
                    <UserAvatar user={request.user} target="_blank" showName={true} size="sm" />
                  </div>
                </td>
                <td class="max-w-[10vw]">
                  <div class="flex items-center gap-2">
                    {#if request.target}
                      {#if request.type === 'university'}
                        <span class="not-xl:hidden">
                          <i class="fa-solid fa-graduation-cap text-primary"></i>
                        </span>
                      {:else}
                        <span class="not-xl:hidden">
                          <i class="fa-solid fa-users-gear text-primary"></i>
                        </span>
                      {/if}
                      <a
                        href="{base}/{request.type === 'university'
                          ? 'universities'
                          : 'clubs'}/{request.target.slug || request.target.id}"
                        target="_blank"
                        class="hover:text-accent line-clamp-3 font-medium transition-colors"
                      >
                        {request.target.name}
                      </a>
                    {:else}
                      <span class="text-base-content/60">{m.admin_unknown()}</span>
                    {/if}
                  </div>
                </td>
                <td class="max-w-[20vw] not-md:hidden">
                  {#if request.requestMessage}
                    <div class="line-clamp-4 text-sm" title={request.requestMessage}>
                      {request.requestMessage}
                    </div>
                  {:else}
                    <span class="text-base-content/40 text-sm italic">{m.admin_no_message()}</span>
                  {/if}
                </td>
                <td class="not-md:hidden">
                  <div class="text-sm">{formatDateTime(request.createdAt)}</div>
                </td>
                <td>
                  <div class="badge badge-soft text-nowrap {getStatusBadgeClass(request.status)}">
                    {statusLabelMap[request.status] || request.status}
                  </div>
                </td>
                <td class="max-w-[20vw] not-lg:hidden">
                  {#if request.reviewNote}
                    <div class="line-clamp-4 text-sm" title={request.reviewNote}>
                      {request.reviewNote}
                    </div>
                  {:else}
                    <span class="text-base-content/40 text-sm italic">{m.none()}</span>
                  {/if}
                  {#if request.reviewedAt}
                    <div class="text-base-content/60 mt-1 text-xs">
                      {m.reviewed_at({ time: formatDateTime(request.reviewedAt) })}
                    </div>
                  {/if}
                </td>
                <td class="max-w-[10vw] not-sm:hidden">
                  {#if request.reviewer}
                    <UserAvatar user={request.reviewer} showName={true} size="xs" />
                  {:else}
                    <span class="text-base-content/40 text-sm italic">{m.none()}</span>
                  {/if}
                </td>
                <td>
                  <div class="flex justify-end gap-2">
                    {#if request.status === 'pending'}
                      <button
                        class="btn btn-success btn-sm text-nowrap"
                        onclick={() => openReviewModal('approve', request)}
                      >
                        <i class="fa-solid fa-check"></i>
                        <span class="not-lg:hidden">{m.approve()}</span>
                      </button>
                      <button
                        class="btn btn-error btn-sm text-nowrap"
                        onclick={() => openReviewModal('reject', request)}
                      >
                        <i class="fa-solid fa-times"></i>
                        <span class="not-lg:hidden">{m.reject()}</span>
                      </button>
                    {/if}
                    <form method="POST" action="?/delete" use:enhance class="inline">
                      <input type="hidden" name="requestId" value={request.id} />
                      <button
                        type="submit"
                        class="btn btn-error btn-sm btn-soft text-nowrap"
                        onclick={() => confirm(m.admin_join_request_delete_confirm())}
                      >
                        <i class="fa-solid fa-trash"></i>
                        <span class="not-lg:hidden">{m.delete()}</span>
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      {#if data.hasMore}
        <div class="border-base-300 border-t p-4">
          <div class="flex justify-center gap-2">
            {#if (data.currentPage || 1) > 1}
              <a
                href={`?page=${(data.currentPage || 1) - 1}${data.filters?.status ? `&status=${data.filters.status}` : ''}${data.filters?.type ? `&type=${data.filters.type}` : ''}`}
                class="btn btn-soft"
              >
                {m.previous_page()}
              </a>
            {/if}
            <span class="btn btn-disabled btn-soft">
              {m.page({ page: data.currentPage || 1 })}
            </span>
            <a
              href={`?page=${(data.currentPage || 1) + 1}${data.filters?.status ? `&status=${data.filters.status}` : ''}${data.filters?.type ? `&type=${data.filters.type}` : ''}`}
              class="btn btn-soft"
            >
              {m.next_page()}
            </a>
          </div>
        </div>
      {/if}
    {:else}
      <div class="py-12 text-center">
        <i class="fa-solid fa-user-plus text-base-content/40 mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">{m.admin_no_join_requests()}</h3>
        <p class="text-base-content/60">{m.admin_no_join_requests_criteria()}</p>
      </div>
    {/if}
  </div>
</div>

<!-- Review Modal -->
<dialog class="modal" class:modal-open={showReviewModal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">
      {reviewAction === 'approve' ? m.admin_approve() : m.admin_reject()}
      {m.join_requests()}
    </h3>

    {#if selectedRequest}
      <div class="pt-4">
        <div class="space-y-3">
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium">{m.admin_user_header()}</span>
            <UserAvatar user={selectedRequest.user} target="_blank" showName={true} size="sm" />
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium">{m.admin_target_header()}</span>
            <span class="ml-2">{selectedRequest.target?.name || m.admin_unknown()}</span>
          </div>
          {#if selectedRequest.requestMessage}
            <div class="flex items-center justify-between gap-3">
              <span class="font-medium">{m.admin_message_header()}</span>
              <div class="bg-base-200 mt-1 rounded-md p-3 text-sm">
                {selectedRequest.requestMessage}
              </div>
            </div>
          {/if}
        </div>

        <form
          method="POST"
          action="?/{reviewAction}"
          use:enhance={() => {
            isSubmitting = true;
            return async ({ result }) => {
              isSubmitting = false;
              if (result.type === 'success') {
                closeReviewModal();
                window.location.reload();
              }
            };
          }}
          class="mt-4"
        >
          <input type="hidden" name="requestId" value={selectedRequest.id} />

          <div class="form-control">
            <label class="label" for="reviewNote">
              <span class="label-text">{m.admin_review_note_optional()}</span>
            </label>
            <textarea
              id="reviewNote"
              name="reviewNote"
              bind:value={reviewNote}
              class="textarea textarea-bordered h-24 w-full rounded-xl"
              placeholder={m.admin_add_note_decision()}
            ></textarea>
          </div>

          <div class="modal-action">
            <button type="button" class="btn" onclick={closeReviewModal} disabled={isSubmitting}>
              {m.cancel()}
            </button>
            <button
              type="submit"
              class="btn {reviewAction === 'approve' ? 'btn-success' : 'btn-error'}"
              disabled={isSubmitting}
            >
              {#if isSubmitting}
                <span class="loading-spinner"></span>
              {:else}
                {reviewAction === 'approve' ? m.approve() : m.reject()}
              {/if}
            </button>
          </div>
        </form>
      </div>
    {/if}
  </div>

  <form method="dialog" class="modal-backdrop">
    <button onclick={closeReviewModal}>{m.close()}</button>
  </form>
</dialog>
