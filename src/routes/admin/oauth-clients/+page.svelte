<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { pageTitle } from '$lib/utils';
  import CopyField from '$lib/components/CopyField.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let showCreateModal = $state(false);
  let showSecretModal = $state(false);
  let showDeleteModal = $state(false);
  let showEditModal = $state(false);
  let deleteTarget = $state<{ clientId: string; name: string } | null>(null);
  let editTarget = $state<NonNullable<typeof data.clients>[number] | null>(null);
  let isSubmitting = $state(false);

  // After successful creation, show secret
  let createdClientId = $derived(
    form && 'created' in form && form.created ? form.created.clientId : null
  );
  let createdClientSecret = $derived(
    form && 'created' in form && form.created ? form.created.clientSecret : null
  );

  $effect(() => {
    if (createdClientId) {
      showCreateModal = false;
      showSecretModal = true;
    }
  });

  $effect(() => {
    if (form && 'updated' in form && form.updated) {
      showEditModal = false;
      editTarget = null;
    }
  });

  const closeSecretModal = async () => {
    showSecretModal = false;
    await invalidateAll();
  };
</script>

<svelte:head>
  <title>{pageTitle(m.admin_oauth_clients(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <!-- Page Header -->
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div class="not-sm:text-center">
      <h1 class="text-2xl font-bold">{m.admin_oauth_clients()}</h1>
      <p class="text-base-content/60 text-sm">{m.admin_oauth_clients_description()}</p>
    </div>
    <button class="btn btn-primary btn-sm" onclick={() => (showCreateModal = true)}>
      <i class="fa-solid fa-plus"></i>
      {m.admin_oauth_create_client()}
    </button>
  </div>

  <!-- Error display -->
  {#if form && 'error' in form && form.error}
    <div class="alert alert-error">
      <i class="fa-solid fa-circle-exclamation"></i>
      <span>{form.error}</span>
    </div>
  {/if}

  <!-- Success display -->
  {#if form && 'deleted' in form && form.deleted}
    <div class="alert alert-success">
      <i class="fa-solid fa-check"></i>
      <span>{m.admin_oauth_client_deleted()}</span>
    </div>
  {/if}

  {#if form && 'updated' in form && form.updated}
    <div class="alert alert-success">
      <i class="fa-solid fa-check"></i>
      <span>{m.admin_oauth_client_updated()}</span>
    </div>
  {/if}

  <!-- Clients list -->
  {#if !data.clients || data.clients.length === 0}
    <div class="bg-base-100 flex flex-col items-center rounded-xl p-12 shadow">
      <i class="fa-solid fa-key fa-3x text-base-content/20 mb-4"></i>
      <p class="text-base-content/60">{m.admin_oauth_no_clients()}</p>
    </div>
  {:else}
    <div class="overflow-x-auto">
      <table class="bg-base-100 table w-full table-fixed rounded-xl shadow">
        <thead>
          <tr>
            <th class="w-[22%]">{m.name()}</th>
            <th class="w-[28%]">Client ID</th>
            <th class="w-[10%]">{m.admin_oauth_type()}</th>
            <th class="w-[22%]">{m.admin_oauth_redirect_uris()}</th>
            <th class="w-[10%]">{m.admin_oauth_consent_skip()}</th>
            <th class="w-[8%]">{m.actions()}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.clients as client (client.clientId)}
            <tr>
              <td class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  {#if client.icon}
                    <img src={client.icon} alt={client.name} class="h-6 w-6 shrink-0 rounded" />
                  {:else}
                    <i class="fa-solid fa-cube text-base-content/30 shrink-0"></i>
                  {/if}
                  <div class="min-w-0">
                    <div class="truncate font-medium" title={client.name}>
                      {client.name}
                    </div>
                    {#if client.uri}
                      <div class="text-base-content/50 truncate text-xs" title={client.uri}>
                        {client.uri}
                      </div>
                    {/if}
                  </div>
                </div>
              </td>
              <td>
                <CopyField value={client.clientId} buttonStyle="ghost" size="xs" display="text" />
              </td>
              <td>
                <span
                  class="badge badge-sm text-nowrap {client.isPublic
                    ? 'badge-info'
                    : 'badge-warning'}"
                >
                  {client.isPublic ? m.admin_oauth_public() : m.admin_oauth_confidential()}
                </span>
              </td>
              <td>
                <div>
                  {#each client.redirectUris.slice(0, 2) as uri, i (i)}
                    <div class="truncate text-xs">{uri}</div>
                  {/each}
                  {#if client.redirectUris.length > 2}
                    <div class="text-base-content/50 text-xs">
                      +{client.redirectUris.length - 2}
                    </div>
                  {/if}
                </div>
              </td>
              <td>
                {#if client.skipConsent}
                  <span class="badge badge-sm badge-success">{m.yes()}</span>
                {:else}
                  <span class="badge badge-ghost badge-sm">{m.no()}</span>
                {/if}
              </td>
              <td>
                <div class="flex gap-1">
                  <button
                    class="btn btn-ghost btn-xs"
                    aria-label={m.admin_oauth_edit_client()}
                    onclick={() => {
                      editTarget = client;
                      showEditModal = true;
                    }}
                  >
                    <i class="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button
                    class="btn btn-ghost btn-xs text-error"
                    aria-label={m.delete()}
                    onclick={() => {
                      deleteTarget = { clientId: client.clientId, name: client.name };
                      showDeleteModal = true;
                    }}
                  >
                    <i class="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Create Client Modal -->
{#if showCreateModal}
  <dialog class="modal modal-open">
    <div class="modal-box">
      <h3 class="mb-4 text-lg font-bold">{m.admin_oauth_create_client()}</h3>

      <form
        method="POST"
        action="?/create"
        use:enhance={() => {
          isSubmitting = true;
          return async ({ update }) => {
            isSubmitting = false;
            await update();
          };
        }}
      >
        <div class="space-y-4">
          <div class="form-control">
            <label class="label" for="client-name">
              <span class="label-text">{m.name()}</span>
            </label>
            <input
              id="client-name"
              name="name"
              type="text"
              class="input input-bordered w-full"
              placeholder="My Application"
              required
              value={form && 'name' in form ? form.name : ''}
            />
          </div>

          <div class="form-control">
            <label class="label" for="client-uri">
              <span class="label-text">{m.admin_oauth_client_uri()}</span>
            </label>
            <input
              id="client-uri"
              name="uri"
              type="url"
              class="input input-bordered w-full"
              placeholder="https://example.com"
            />
          </div>

          <div class="form-control">
            <label class="label" for="client-icon">
              <span class="label-text">{m.admin_oauth_client_icon()}</span>
            </label>
            <input
              id="client-icon"
              name="icon"
              type="url"
              class="input input-bordered w-full"
              placeholder="https://example.com/icon.png"
            />
          </div>

          <div class="form-control">
            <label class="label" for="client-redirects">
              <span class="label-text">{m.admin_oauth_redirect_uris()}</span>
            </label>
            <textarea
              id="client-redirects"
              name="redirect_uris"
              class="textarea textarea-bordered w-full rounded-xl"
              rows="3"
              placeholder="https://example.com/callback"
              required
              value={form && 'redirect_uris' in form ? String(form.redirect_uris ?? '') : ''}
            ></textarea>
            <div class="label">
              <span class="label-text-alt text-base-content/50">
                {m.admin_oauth_redirect_uris_hint()}
              </span>
            </div>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input name="is_public" type="checkbox" class="checkbox checkbox-sm" />
              <div>
                <span class="label-text">{m.admin_oauth_public_client()}</span>
                <p class="text-base-content/50 text-xs">
                  {m.admin_oauth_public_client_hint()}
                </p>
              </div>
            </label>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input name="skip_consent" type="checkbox" class="checkbox checkbox-sm" />
              <div>
                <span class="label-text">{m.admin_oauth_skip_consent()}</span>
                <p class="text-base-content/50 text-xs">
                  {m.admin_oauth_skip_consent_hint()}
                </p>
              </div>
            </label>
          </div>
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={() => (showCreateModal = false)}>
            {m.cancel()}
          </button>
          <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
            {#if isSubmitting}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
            {m.admin_oauth_create_client()}
          </button>
        </div>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button type="button" onclick={() => (showCreateModal = false)}>close</button>
    </form>
  </dialog>
{/if}

<!-- Secret Display Modal (shown once after creation) -->
{#if showSecretModal && createdClientId}
  <dialog class="modal modal-open">
    <div class="modal-box">
      <h3 class="mb-2 text-lg font-bold">{m.admin_oauth_client_created()}</h3>
      {#if createdClientSecret}
        <div class="alert alert-warning mb-4">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>{m.admin_oauth_secret_warning()}</span>
        </div>
      {/if}

      <div class="space-y-3">
        <div class="form-control">
          <label class="label" for="created-client-id">
            <span class="label-text font-medium">Client ID</span>
          </label>
          <CopyField id="created-client-id" value={createdClientId} ariaLabel="Copy Client ID" />
        </div>

        {#if createdClientSecret}
          <div class="form-control">
            <label class="label" for="created-client-secret">
              <span class="label-text font-medium">Client Secret</span>
            </label>
            <CopyField
              id="created-client-secret"
              value={createdClientSecret}
              ariaLabel="Copy Client Secret"
            />
          </div>
        {/if}
      </div>

      <div class="modal-action">
        <button class="btn btn-primary" onclick={closeSecretModal}>
          {m.admin_oauth_done()}
        </button>
      </div>
    </div>
  </dialog>
{/if}

<!-- Edit Client Modal -->
{#if showEditModal && editTarget}
  <dialog class="modal modal-open">
    <div class="modal-box">
      <h3 class="mb-4 text-lg font-bold">{m.admin_oauth_edit_client()}</h3>

      <form
        method="POST"
        action="?/update"
        use:enhance={() => {
          isSubmitting = true;
          return async ({ update }) => {
            isSubmitting = false;
            await update();
          };
        }}
      >
        <input type="hidden" name="client_id" value={editTarget.clientId} />

        <div class="space-y-4">
          <div class="form-control">
            <label class="label" for="edit-client-name">
              <span class="label-text">{m.name()}</span>
            </label>
            <input
              id="edit-client-name"
              name="name"
              type="text"
              class="input input-bordered w-full"
              placeholder="My Application"
              required
              value={form &&
              'updateClientId' in form &&
              form.updateClientId === editTarget.clientId &&
              'name' in form
                ? String(form.name ?? '')
                : editTarget.name}
            />
          </div>

          <div class="form-control">
            <label class="label" for="edit-client-uri">
              <span class="label-text">{m.admin_oauth_client_uri()}</span>
            </label>
            <input
              id="edit-client-uri"
              name="uri"
              type="url"
              class="input input-bordered w-full"
              placeholder="https://example.com"
              value={editTarget.uri ?? ''}
            />
          </div>

          <div class="form-control">
            <label class="label" for="edit-client-icon">
              <span class="label-text">{m.admin_oauth_client_icon()}</span>
            </label>
            <input
              id="edit-client-icon"
              name="icon"
              type="url"
              class="input input-bordered w-full"
              placeholder="https://example.com/icon.png"
              value={editTarget.icon ?? ''}
            />
          </div>

          <div class="form-control">
            <label class="label" for="edit-client-redirects">
              <span class="label-text">{m.admin_oauth_redirect_uris()}</span>
            </label>
            <textarea
              id="edit-client-redirects"
              name="redirect_uris"
              class="textarea textarea-bordered w-full rounded-xl"
              rows="3"
              placeholder="https://example.com/callback"
              required
              value={form &&
              'updateClientId' in form &&
              form.updateClientId === editTarget.clientId &&
              'redirect_uris' in form
                ? String(form.redirect_uris ?? '')
                : editTarget.redirectUris.join('\n')}
            ></textarea>
            <div class="label">
              <span class="label-text-alt text-base-content/50">
                {m.admin_oauth_redirect_uris_hint()}
              </span>
            </div>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                name="skip_consent"
                type="checkbox"
                class="checkbox checkbox-sm"
                checked={editTarget.skipConsent}
              />
              <div>
                <span class="label-text">{m.admin_oauth_skip_consent()}</span>
                <p class="text-base-content/50 text-xs">
                  {m.admin_oauth_skip_consent_hint()}
                </p>
              </div>
            </label>
          </div>
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => {
              showEditModal = false;
              editTarget = null;
            }}
          >
            {m.cancel()}
          </button>
          <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
            {#if isSubmitting}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
            {m.admin_oauth_update_client()}
          </button>
        </div>
      </form>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button
        type="button"
        onclick={() => {
          showEditModal = false;
          editTarget = null;
        }}>close</button
      >
    </form>
  </dialog>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteModal && deleteTarget}
  <dialog class="modal modal-open">
    <div class="modal-box">
      <h3 class="text-lg font-bold">{m.admin_oauth_delete_client()}</h3>
      <p class="py-4">
        {m.admin_oauth_delete_confirm({ name: deleteTarget.name })}
      </p>
      <div class="modal-action">
        <button class="btn btn-ghost" onclick={() => (showDeleteModal = false)}>
          {m.cancel()}
        </button>
        <form
          method="POST"
          action="?/delete"
          use:enhance={() => {
            isSubmitting = true;
            return async ({ update }) => {
              isSubmitting = false;
              showDeleteModal = false;
              deleteTarget = null;
              await update();
            };
          }}
        >
          <input type="hidden" name="client_id" value={deleteTarget.clientId} />
          <button type="submit" class="btn btn-error" disabled={isSubmitting}>
            {#if isSubmitting}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
            {m.delete()}
          </button>
        </form>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button type="button" onclick={() => (showDeleteModal = false)}>close</button>
    </form>
  </dialog>
{/if}
