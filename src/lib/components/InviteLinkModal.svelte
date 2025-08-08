<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { InviteLink } from '$lib/types';
  import { fromPath } from '$lib/utils';

  let { isOpen = $bindable(false), type = 'university', targetId = '', targetName = '' } = $props();

  let title = $state('');
  let description = $state('');
  let expiresAt = $state('');
  let maxUses = $state<number | null>(null);
  let requireApproval = $state(false);
  let isGenerating = $state(false);
  let isCopied = $state(false);
  let generatedLink = $state<InviteLink | null>(null);

  const handleGenerate = async () => {
    isGenerating = true;

    try {
      const response = await fetch(fromPath('/api/invites'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          type,
          targetId,
          title,
          description,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          maxUses,
          requireApproval
        })
      });

      if (response.ok) {
        const data = (await response.json()) as { invite: InviteLink };
        generatedLink = data.invite;
      } else {
        console.error('Failed to generate invite');
      }
    } catch (error) {
      console.error('Error generating invite:', error);
    } finally {
      isGenerating = false;
    }
  };

  const handleClose = () => {
    isOpen = false;
    // Reset form
    title = '';
    description = '';
    expiresAt = '';
    maxUses = null;
    requireApproval = false;
    generatedLink = null;
  };

  const copyLink = async () => {
    if (generatedLink) {
      const fullLink = `${window.location.origin}/invite/${generatedLink.code}`;
      const text = `[${m.app_name()}] ${title || m.invite_title_placeholder({ target: targetName })}\n${fullLink}`;
      try {
        await navigator.clipboard.writeText(text);
        isCopied = true;
        setTimeout(() => {
          isCopied = false;
        }, 2000);
      } catch (error) {
        console.error('Failed to copy link:', error);
      }
    }
  };
</script>

<div class="modal" class:modal-open={isOpen}>
  <div class="modal-box max-w-2xl">
    <h3 class="mb-4 text-lg font-bold">
      {m.generate_invite_link()}
      {#if targetName}
        - {targetName}
      {/if}
    </h3>

    {#if !generatedLink}
      <!-- Invite Form -->
      <div class="space-y-4">
        <!-- Title -->
        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text">{m.invite_title()}</span>
          </label>
          <input
            type="text"
            class="input input-bordered w-full"
            bind:value={title}
            placeholder={m.invite_title_placeholder({ target: targetName })}
          />
        </div>

        <!-- Description -->
        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text">{m.invite_description()}</span>
          </label>
          <textarea class="textarea textarea-bordered w-full" bind:value={description} rows="3"
          ></textarea>
        </div>

        <!-- Expiration Date -->
        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text">{m.expiration_date()}</span>
          </label>
          <input type="datetime-local" class="input input-bordered w-full" bind:value={expiresAt} />
        </div>

        <!-- Max Uses -->
        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text">{m.max_uses_count()}</span>
          </label>
          <input
            type="number"
            class="input input-bordered w-full"
            bind:value={maxUses}
            min="1"
            placeholder={m.none()}
          />
        </div>

        <!-- Settings -->
        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text">{m.invite_settings()}</span>
          </label>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="label cursor-pointer justify-start gap-2">
              <input
                type="checkbox"
                class="checkbox checkbox-sm hover:checkbox-primary checked:checkbox-primary transition"
                bind:checked={requireApproval}
              />
              <span class="label-text">{m.require_approval()}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Modal Actions -->
      <div class="modal-action">
        <button class="btn btn-ghost" onclick={handleClose}>
          {m.cancel()}
        </button>
        <button class="btn btn-primary btn-soft" onclick={handleGenerate} disabled={isGenerating}>
          {#if isGenerating}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            {m.generate_invite_link()}
          {/if}
        </button>
      </div>
    {:else}
      <!-- Generated Link Display -->
      <div class="space-y-4">
        <div class="form-control">
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="label">
            <span class="label-text">{m.invite_link()}</span>
          </label>
          <div class="join w-full">
            <input
              type="text"
              class="input input-bordered join-item flex-1"
              value="{window.location.origin}/invite/{generatedLink.code}"
              readonly
            />
            <button
              class="btn btn-primary btn-soft join-item"
              class:btn-disabled={isCopied}
              onclick={copyLink}
            >
              {#if isCopied}
                <i class="fa-solid fa-check"></i>
                {m.copied()}
              {:else}
                <i class="fa-solid fa-copy"></i>
                {m.copy_link()}
              {/if}
            </button>
          </div>
        </div>

        <!-- Link Details -->
        <div class="bg-base-200 rounded-lg p-4">
          <h4 class="mb-2 font-medium">{m.details()}</h4>
          <div class="grid grid-cols-2 gap-2 text-sm">
            {#if generatedLink.title}
              <p><strong>{m.title()}</strong><br />{generatedLink.title}</p>
            {/if}
            {#if generatedLink.description}
              <p><strong>{m.description()}</strong><br />{generatedLink.description}</p>
            {/if}
            <p>
              <strong>{m.expiration_date()}</strong><br />
              {#if generatedLink.expiresAt}
                {new Date(generatedLink.expiresAt).toLocaleString()}
              {:else}
                {m.none()}
              {/if}
            </p>
            <p>
              <strong>{m.max_uses_count()}</strong><br />
              {#if generatedLink.maxUses}
                {generatedLink.maxUses}
              {:else}
                {m.none()}
              {/if}
            </p>
          </div>
        </div>
      </div>

      <!-- Modal Actions -->
      <div class="modal-action">
        <button class="btn btn-primary btn-soft" onclick={handleClose}>{m.done()}</button>
      </div>
    {/if}
  </div>
  <div
    class="modal-backdrop"
    onclick={handleClose}
    onkeydown={(e) => e.key === 'Escape' && handleClose()}
    role="button"
    tabindex="0"
    aria-label={m.close_modal()}
  ></div>
</div>
