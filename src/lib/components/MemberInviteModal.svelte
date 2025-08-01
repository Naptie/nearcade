<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';

  interface Props {
    open?: boolean;
    universityId: string;
    universityName: string;
  }

  let { open = $bindable(false), universityId, universityName }: Props = $props();

  let form: HTMLFormElement;
  let isSubmitting = $state(false);
  let errorMessage = $state('');

  // Form data
  let formData = $state({
    email: '',
    memberType: 'student'
  });

  function handleClose() {
    open = false;
    errorMessage = '';
    formData = { email: '', memberType: 'student' };
  }
</script>

<!-- Modal -->
<dialog class="modal" class:modal-open={open}>
  <div class="modal-box max-w-lg">
    <!-- Header -->
    <div class="mb-6 flex items-center justify-between">
      <h3 class="text-lg font-bold">
        {m.invite_members()}
      </h3>
      <p class="text-base-content/60 text-sm">{universityName}</p>
    </div>

    <!-- Error Alert -->
    {#if errorMessage}
      <div class="alert alert-error mb-4">
        <i class="fa-solid fa-exclamation-triangle"></i>
        <span>{errorMessage}</span>
      </div>
    {/if}

    <!-- Form -->
    <form
      bind:this={form}
      method="POST"
      action="?/inviteMember"
      use:enhance={() => {
        isSubmitting = true;
        return async ({ result }) => {
          isSubmitting = false;

          if (result.type === 'success') {
            handleClose();
            await invalidateAll();
          } else if (result.type === 'failure') {
            errorMessage = (result.data?.message as string) || m.form_validation_error();
          } else if (result.type === 'error') {
            errorMessage = 'An unexpected error occurred.';
          }
        };
      }}
      class="space-y-4"
    >
      <!-- Hidden fields -->
      <input type="hidden" name="universityId" value={universityId} />

      <!-- Email -->
      <div class="form-control">
        <label class="label" for="member-email">
          <span class="label-text">{m.email_address()}</span>
          <span class="label-text-alt text-error">*</span>
        </label>
        <input
          id="member-email"
          name="email"
          type="email"
          bind:value={formData.email}
          placeholder={m.email_placeholder()}
          class="input input-bordered w-full"
          required
        />
      </div>

      <!-- Member Type -->
      <div class="form-control">
        <label class="label" for="member-type">
          <span class="label-text">{m.user_type()}</span>
        </label>
        <select
          id="member-type"
          name="memberType"
          bind:value={formData.memberType}
          class="select select-bordered w-full"
        >
          <option value="student">{m.student()}</option>
          <option value="moderator">{m.moderator()}</option>
          <option value="admin">{m.admin()}</option>
        </select>
        <div class="label">
          <span class="label-text-alt">
            {formData.memberType === 'admin'
              ? 'Can manage everything including other members'
              : formData.memberType === 'moderator'
                ? 'Can edit university info and manage content'
                : 'Regular university member'}
          </span>
        </div>
      </div>

      <!-- Form Actions -->
      <div class="modal-action">
        <button type="button" class="btn btn-ghost" onclick={handleClose}>
          {m.cancel()}
        </button>
        <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
          {#if isSubmitting}
            <span class="loading loading-spinner loading-sm"></span>
            {m.invite()}...
          {:else}
            <i class="fa-solid fa-user-plus"></i>
            {m.invite()}
          {/if}
        </button>
      </div>
    </form>
  </div>
</dialog>
