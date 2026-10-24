<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { orpc } from '$lib/api/client';

  interface Props {
    shopId: number;
    /** The changelog entry the preview was taken at — the previewed state
     * includes this entry's change; everything recorded after it is reverted. */
    targetEntryId: string;
    /** Authors of the reverted changes, for the confirmation summary. */
    authors: { id: string; name: string | null }[];
    photoCount: number;
    open?: boolean;
    onApplied?: () => void | Promise<void>;
  }

  let {
    shopId,
    targetEntryId,
    authors,
    photoCount,
    open = $bindable(false),
    onApplied
  }: Props = $props();

  // Retention sticks across dialogs (an admin doing a series of moderation
  // rollbacks wants the same policy); the incident-specific options reset on
  // every open so a benign rollback never inherits "delete photos" or a
  // custom notice from the previous one.
  let retention = $state<'keep' | 'purge'>('keep');
  let removePhotos = $state(false);
  let notifyEnabled = $state(false);
  let notifyMessage = $state('');
  let isApplying = $state(false);
  let errorMessage = $state<string | null>(null);

  $effect(() => {
    if (open) {
      removePhotos = false;
      notifyEnabled = false;
      notifyMessage = '';
      errorMessage = null;
    }
  });

  const apply = async () => {
    if (isApplying) return;
    isApplying = true;
    errorMessage = null;

    try {
      await orpc.admin.rollbackShop({
        id: shopId,
        targetEntryId,
        retention,
        removePhotos,
        notify: {
          enabled: notifyEnabled,
          ...(notifyMessage.trim() ? { message: notifyMessage.trim() } : {})
        }
      });

      open = false;
      await onApplied?.();
    } catch (err) {
      console.error('Failed to apply rollback:', err);
      errorMessage = m.failed_to_update();
    } finally {
      isApplying = false;
    }
  };
</script>

{#if open}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="text-lg font-bold">{m.shop_changelog_rollback_confirm()}</h3>

      {#if errorMessage}
        <div class="alert alert-error mt-4">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <span>{errorMessage}</span>
        </div>
      {/if}

      <div class="mt-4 space-y-3">
        <div>
          <span class="mb-1 block text-sm font-medium">
            {m.shop_changelog_rollback_option_retention()}
          </span>
          <select class="select select-sm w-full" bind:value={retention}>
            <option value="keep">{m.shop_changelog_rollback_retention_keep()}</option>
            <option value="purge">{m.shop_changelog_rollback_retention_purge()}</option>
          </select>
        </div>

        {#if photoCount > 0}
          <div>
            <label class="flex cursor-pointer items-center gap-2">
              <input type="checkbox" class="checkbox checkbox-sm" bind:checked={removePhotos} />
              <span class="text-sm">{m.shop_changelog_rollback_remove_photos()}</span>
            </label>
            <p class="text-base-content/60 mt-1 text-xs">
              {m.shop_changelog_rollback_photos_in_range({ count: photoCount })}
            </p>
          </div>
        {/if}

        <div>
          <label class="flex cursor-pointer items-center gap-2">
            <input type="checkbox" class="checkbox checkbox-sm" bind:checked={notifyEnabled} />
            <span class="text-sm">{m.shop_changelog_rollback_notify_label()}</span>
          </label>
          {#if notifyEnabled}
            <textarea
              class="textarea textarea-sm mt-2 w-full rounded-xl"
              rows="2"
              maxlength="500"
              bind:value={notifyMessage}
              placeholder={m.shop_changelog_rollback_notify_message()}
            ></textarea>
          {/if}
        </div>

        {#if authors.length > 0}
          <p class="text-base-content/60 text-xs">
            {m.shop_changelog_rollback_authors({
              names: authors.map((author) => author.name ?? author.id).join(', ')
            })}
          </p>
        {/if}
      </div>

      <div class="modal-action">
        <button class="btn btn-ghost" onclick={() => (open = false)} disabled={isApplying}>
          {m.cancel()}
        </button>
        <button class="btn btn-primary" onclick={apply} disabled={isApplying}>
          {#if isApplying}<span class="loading loading-spinner loading-sm"></span>{/if}
          {m.shop_changelog_rollback_confirm()}
        </button>
      </div>
    </div>
    <button class="modal-backdrop" onclick={() => (open = false)}>{m.close()}</button>
  </div>
{/if}
