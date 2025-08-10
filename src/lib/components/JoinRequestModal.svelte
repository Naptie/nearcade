<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';

  let {
    isOpen = $bindable(false),
    clubId,
    clubName,
    onSuccess = () => {}
  }: {
    isOpen: boolean;
    clubId: string;
    clubName: string;
    onSuccess?: () => void;
  } = $props();

  let requestMessage = $state('');
  let isSubmitting = $state(false);

  const closeModal = () => {
    isOpen = false;
    requestMessage = '';
  };

  const handleSuccess = () => {
    onSuccess();
    closeModal();
  };
</script>

<!-- Join Request Modal -->
<dialog class="modal" class:modal-open={isOpen}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">
      {m.join_club()} - {clubName}
    </h3>

    <form
      method="POST"
      action="?/joinRequest"
      use:enhance={() => {
        isSubmitting = true;
        return async ({ result }) => {
          isSubmitting = false;
          if (result.type === 'success') {
            handleSuccess();
          }
        };
      }}
    >
      <input type="hidden" name="clubId" value={clubId} />

      <div class="form-control mt-4">
        <label class="label" for="requestMessage">
          <span class="label-text">{m.join_request_message()}</span>
        </label>
        <textarea
          id="requestMessage"
          name="requestMessage"
          bind:value={requestMessage}
          class="textarea textarea-bordered h-24 w-full rounded-xl"
          placeholder={m.join_request_message_placeholder()}
        ></textarea>
      </div>

      <div class="modal-action">
        <button type="button" class="btn" onclick={closeModal} disabled={isSubmitting}>
          {m.cancel()}
        </button>
        <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
          {#if isSubmitting}
            <span class="loading loading-spinner loading-sm"></span>
          {:else}
            {m.join_club()}
          {/if}
        </button>
      </div>
    </form>
  </div>

  <!-- Modal backdrop -->
  <form method="dialog" class="modal-backdrop">
    <button onclick={closeModal}>{m.close()}</button>
  </form>
</dialog>
