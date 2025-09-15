<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import { formatDistanceToNow } from 'date-fns';
  import { getLocale } from '$lib/paraglide/runtime';
  import { zhCN, enUS } from 'date-fns/locale';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let isSubmitting = $state(false);
  let showSuccess = $state(false);
  let showCreateModal = $state(false);
  let showRenameModal = $state(false);
  let showDeleteModal = $state(false);
  let currentToken = $state<{ id: string; name: string; token: string; expiresAt: string | Date; createdAt: string | Date } | null>(null);
  let createdToken = $state<{ id: string; name: string; token: string; expiresAt: string | Date; createdAt: string | Date } | null>(null);

  // Form states
  let tokenName = $state('');
  let expiration = $state('30days');
  let customDate = $state('');
  let renameTokenName = $state('');

  // Get locale for date formatting
  const locale = getLocale();
  const dateLocale = locale === 'zh' ? zhCN : enUS;

  // Form validation
  let clientErrors = $state<Record<string, string>>({});

  const validateField = (field: string, value: string) => {
    switch (field) {
      case 'tokenName':
        if (!value.trim()) {
          clientErrors.tokenName = 'api_token_name_required';
        } else if (value.trim().length > 50) {
          clientErrors.tokenName = 'name_too_long';
        } else {
          delete clientErrors.tokenName;
        }
        break;
      case 'renameTokenName':
        if (!value.trim()) {
          clientErrors.renameTokenName = 'api_token_name_required';
        } else if (value.trim().length > 50) {
          clientErrors.renameTokenName = 'name_too_long';
        } else {
          delete clientErrors.renameTokenName;
        }
        break;
    }
    clientErrors = { ...clientErrors };
  };

  // Check if form is valid
  let isCreateFormValid = $derived.by(() => {
    return tokenName.trim().length > 0 && !clientErrors.tokenName;
  });

  let isRenameFormValid = $derived.by(() => {
    return renameTokenName.trim().length > 0 && !clientErrors.renameTokenName;
  });

  // Safe message getter
  const getMessage = (key: string | undefined): string => {
    if (!key) return '';

    switch (key) {
      case 'api_token_name_required':
        return m.api_token_name_required();
      case 'name_too_long':
        return m.name_too_long({ max: 50 });
      case 'field_required':
        return m.field_required();
      case 'api_token_created':
        return m.api_token_created();
      case 'api_token_renamed':
        return m.api_token_renamed();
      case 'api_token_deleted':
        return m.api_token_deleted();
      case 'cancel':
        return m.cancel();
      case 'delete':
        return m.delete();
      default:
        return key;
    }
  };

  // Modal handlers
  const openCreateModal = () => {
    tokenName = '';
    expiration = '30days';
    customDate = '';
    clientErrors = {};
    showCreateModal = true;
  };

  const closeCreateModal = () => {
    showCreateModal = false;
    createdToken = null;
  };

  const openRenameModal = (token: { id: string; name: string; token: string; expiresAt: string | Date; createdAt: string | Date }) => {
    currentToken = token;
    renameTokenName = token.name;
    clientErrors = {};
    showRenameModal = true;
  };

  const closeRenameModal = () => {
    showRenameModal = false;
    currentToken = null;
  };

  const openDeleteModal = (token: { id: string; name: string; token: string; expiresAt: string | Date; createdAt: string | Date }) => {
    currentToken = token;
    showDeleteModal = true;
  };

  const closeDeleteModal = () => {
    showDeleteModal = false;
    currentToken = null;
  };

  // Copy token to clipboard
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Show brief success feedback
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  // Handle form results
  $effect(() => {
    if (form?.success && form?.token) {
      createdToken = form.token;
      tokenName = '';
      expiration = '30days';
      customDate = '';
      clientErrors = {};
      invalidateAll();
    } else if (form?.success && form?.message === 'api_token_renamed') {
      closeRenameModal();
      invalidateAll();
    } else if (form?.success && form?.message === 'api_token_deleted') {
      closeDeleteModal();
      invalidateAll();
    }

    if (form?.success) {
      showSuccess = true;
      setTimeout(() => {
        showSuccess = false;
      }, 5000);
    }
  });

  // Check if token is expired
  const isExpired = (expiresAt: string | Date) => {
    return new Date(expiresAt) < Date.now();
  };

  // Format expiration date
  const formatExpiresAt = (expiresAt: string | Date) => {
    return formatDistanceToNow(new Date(expiresAt), {
      addSuffix: true,
      locale: dateLocale
    });
  };

  // Set minimum date for custom expiration (today)
  const today = new Date().toISOString().split('T')[0];
  // Set maximum date (1 year from now)
  const oneYearDate = new Date();
  oneYearDate.setFullYear(oneYearDate.getFullYear() + 1);
  const maxDate = oneYearDate.toISOString().split('T')[0];
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold">{m.api_tokens_management()}</h1>
    <p class="text-base-content/70 mt-1">
      {m.api_tokens_description()}
    </p>
  </div>

  <!-- Success Alert -->
  {#if showSuccess && form?.success}
    <div class="alert alert-success">
      <i class="fa-solid fa-check-circle"></i>
      <span>{getMessage(form.message)}</span>
    </div>
  {/if}

  <!-- Error Alert -->
  {#if form?.message && !form.success}
    <div class="alert alert-error">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <span>{getMessage(form.message)}</span>
    </div>
  {/if}

  <!-- Create Token Button -->
  <div class="flex justify-end">
    <button class="btn btn-primary" onclick={openCreateModal}>
      <i class="fa-solid fa-plus"></i>
      {m.create_api_token()}
    </button>
  </div>

  <!-- API Tokens List -->
  <div class="bg-base-100 rounded-lg p-6">
    <h3 class="mb-4 text-lg font-semibold">{m.api_tokens()}</h3>

    {#if data.apiTokens && data.apiTokens.length > 0}
      <div class="space-y-4">
        {#each data.apiTokens as token (token.id)}
          <div class="bg-base-200 flex items-center justify-between rounded-lg p-4">
            <div class="flex-1">
              <div class="flex items-center gap-3">
                <h4 class="font-medium">{token.name}</h4>
                {#if isExpired(token.expiresAt)}
                  <span class="badge badge-error">{m.expired()}</span>
                {:else}
                  <span class="badge badge-success">{m.active()}</span>
                {/if}
              </div>
              <div class="text-base-content/60 mt-1 text-sm">
                <p>{m.expires_at()}: {formatExpiresAt(token.expiresAt)}</p>
                <p>
                  Created: {formatDistanceToNow(new Date(token.createdAt), {
                    addSuffix: true,
                    locale: dateLocale
                  })}
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button
                class="btn btn-sm btn-ghost"
                onclick={() => openRenameModal(token)}
                title={m.rename_token()}
              >
                <i class="fa-solid fa-edit"></i>
                {m.rename()}
              </button>
              <button
                class="btn btn-sm btn-error"
                onclick={() => openDeleteModal(token)}
                title={m.delete()}
              >
                <i class="fa-solid fa-trash"></i>
                {m.delete()}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="py-12 text-center">
        <i class="fa-solid fa-key text-base-content/30 mb-4 text-4xl"></i>
        <h3 class="text-base-content/60 mb-2 text-lg font-medium">{m.no_tokens_yet()}</h3>
        <p class="text-base-content/50 mb-4">{m.api_tokens_description()}</p>
        <button class="btn btn-primary" onclick={openCreateModal}>
          <i class="fa-solid fa-plus"></i>
          {m.create_api_token()}
        </button>
      </div>
    {/if}
  </div>
</div>

<!-- Create Token Modal -->
{#if showCreateModal}
  <div class="modal modal-open">
    <div class="modal-box w-11/12 max-w-md">
      {#if createdToken}
        <!-- Token Created Successfully -->
        <h3 class="mb-4 text-lg font-bold">{m.api_token_created()}</h3>

        <div class="space-y-4">
          <div class="alert alert-warning">
            <i class="fa-solid fa-exclamation-triangle"></i>
            <span>{m.copy_token_warning()}</span>
          </div>

          <div>
            <label class="label" for="token-display-name">
              <span class="label-text font-medium">{m.api_token_name()}</span>
            </label>
            <input
              id="token-display-name"
              type="text"
              class="input input-bordered w-full"
              value={createdToken.name}
              readonly
            />
          </div>

          <div>
            <label class="label" for="token-display-value">
              <span class="label-text font-medium">{m.api_token()}</span>
            </label>
            <div class="flex gap-2">
              <input
                id="token-display-value"
                type="text"
                class="input input-bordered w-full font-mono text-sm"
                value={createdToken.token}
                readonly
              />
              <button
                type="button"
                class="btn btn-square btn-outline"
                onclick={() => copyToClipboard(createdToken.token)}
                title={m.copy_token()}
                aria-label={m.copy_token()}
              >
                <i class="fa-solid fa-copy"></i>
              </button>
            </div>
          </div>

          <div>
            <label class="label" for="token-display-expires">
              <span class="label-text font-medium">{m.expires_at()}</span>
            </label>
            <input
              id="token-display-expires"
              type="text"
              class="input input-bordered w-full"
              value={formatExpiresAt(createdToken.expiresAt)}
              readonly
            />
          </div>
        </div>

        <div class="modal-action">
          <button class="btn btn-primary" onclick={closeCreateModal}>
            {m.confirm()}
          </button>
        </div>
      {:else}
        <!-- Create Token Form -->
        <h3 class="mb-4 text-lg font-bold">{m.create_api_token()}</h3>

        <form
          method="POST"
          action="?/createToken"
          use:enhance={() => {
            isSubmitting = true;
            return async () => {
              isSubmitting = false;
            };
          }}
        >
          <div class="space-y-4">
            <div class="form-control">
              <label class="label" for="token-name">
                <span class="label-text">{m.api_token_name()}</span>
                <span class="label-text-alt text-error">*</span>
              </label>
              <input
                id="token-name"
                name="name"
                type="text"
                bind:value={tokenName}
                oninput={() => validateField('tokenName', tokenName)}
                placeholder={m.api_token_name_placeholder()}
                class="input input-bordered w-full"
                class:input-error={clientErrors.tokenName}
                maxlength="50"
                required
              />
              {#if clientErrors.tokenName}
                <div class="label">
                  <span class="label-text-alt text-error">
                    <i class="fa-solid fa-exclamation-triangle mr-1"></i>
                    {getMessage(clientErrors.tokenName)}
                  </span>
                </div>
              {/if}
            </div>

            <div class="form-control">
              <label class="label" for="expiration-select">
                <span class="label-text">{m.api_token_expiration()}</span>
              </label>
              <select
                id="expiration-select"
                name="expiration"
                bind:value={expiration}
                class="select select-bordered w-full"
              >
                <option value="1day">{m.expires_in_1_day()}</option>
                <option value="1week">{m.expires_in_1_week()}</option>
                <option value="30days">{m.expires_in_30_days()}</option>
                <option value="90days">{m.expires_in_90_days()}</option>
                <option value="1year">{m.expires_in_1_year()}</option>
                <option value="custom">{m.expires_in_custom()}</option>
              </select>
            </div>

            {#if expiration === 'custom'}
              <div class="form-control">
                <label class="label" for="custom-date">
                  <span class="label-text">Custom Expiration Date</span>
                  <span class="label-text-alt text-error">*</span>
                </label>
                <input
                  id="custom-date"
                  name="customDate"
                  type="date"
                  bind:value={customDate}
                  min={today}
                  max={maxDate}
                  class="input input-bordered w-full"
                  required
                />
              </div>
            {/if}
          </div>

          <div class="modal-action">
            <button type="button" class="btn" onclick={closeCreateModal}>
              {m.cancel()}
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              disabled={isSubmitting || !isCreateFormValid}
            >
              {#if isSubmitting}
                <span class="loading loading-spinner loading-sm"></span>
              {:else}
                <i class="fa-solid fa-plus"></i>
              {/if}
              {m.create()}
            </button>
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}

<!-- Rename Token Modal -->
{#if showRenameModal && currentToken}
  <div class="modal modal-open">
    <div class="modal-box w-11/12 max-w-md">
      <h3 class="mb-4 text-lg font-bold">{m.rename_token()}</h3>

      <form
        method="POST"
        action="?/renameToken"
        use:enhance={() => {
          isSubmitting = true;
          return async () => {
            isSubmitting = false;
          };
        }}
      >
        <input type="hidden" name="tokenId" value={currentToken.id} />

        <div class="form-control">
          <label class="label" for="rename-token-name">
            <span class="label-text">{m.api_token_name()}</span>
            <span class="label-text-alt text-error">*</span>
          </label>
          <input
            id="rename-token-name"
            name="name"
            type="text"
            bind:value={renameTokenName}
            oninput={() => validateField('renameTokenName', renameTokenName)}
            placeholder={m.api_token_name_placeholder()}
            class="input input-bordered w-full"
            class:input-error={clientErrors.renameTokenName}
            maxlength="50"
            required
          />
          {#if clientErrors.renameTokenName}
            <div class="label">
              <span class="label-text-alt text-error">
                <i class="fa-solid fa-exclamation-triangle mr-1"></i>
                {getMessage(clientErrors.renameTokenName)}
              </span>
            </div>
          {/if}
        </div>

        <div class="modal-action">
          <button type="button" class="btn" onclick={closeRenameModal}>
            {m.cancel()}
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            disabled={isSubmitting || !isRenameFormValid}
          >
            {#if isSubmitting}
              <span class="loading loading-spinner loading-sm"></span>
            {:else}
              <i class="fa-solid fa-save"></i>
            {/if}
            {m.rename()}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- Delete Token Modal -->
{#if showDeleteModal && currentToken}
  <div class="modal modal-open">
    <div class="modal-box w-11/12 max-w-md">
      <h3 class="mb-4 text-lg font-bold">{m.confirm_delete_token_title()}</h3>

      <p class="py-4">{m.confirm_delete_token()}</p>
      <p class="text-base-content/60 mb-4 text-sm">
        Token: <strong>{currentToken.name}</strong>
      </p>

      <form
        method="POST"
        action="?/deleteToken"
        use:enhance={() => {
          isSubmitting = true;
          return async () => {
            isSubmitting = false;
          };
        }}
      >
        <input type="hidden" name="tokenId" value={currentToken.id} />

        <div class="modal-action">
          <button type="button" class="btn" onclick={closeDeleteModal}>
            {m.cancel()}
          </button>
          <button type="submit" class="btn btn-error" disabled={isSubmitting}>
            {#if isSubmitting}
              <span class="loading loading-spinner loading-sm"></span>
            {:else}
              <i class="fa-solid fa-trash"></i>
            {/if}
            {m.delete()}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
