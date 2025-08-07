<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import { getDisplayName } from '$lib/utils';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let isSubmitting = $state(false);
  let showSuccess = $state(false);

  // Form data with error handling
  let displayName = $state(data.userProfile?.displayName || '');
  let bio = $state(data.userProfile?.bio || '');
  let username = $state(data.userProfile?.name || '');
  let isEmailPublic = $state(data.userProfile?.isEmailPublic || false);
  let isUniversityPublic = $state(data.userProfile?.isUniversityPublic !== false);
  let isFrequentingArcadePublic = $state(data.userProfile?.isFrequentingArcadePublic || false);
  let isStarredArcadePublic = $state(data.userProfile?.isStarredArcadePublic || false);

  // Reset form data when form errors occur (preserve user input)
  $effect(() => {
    if (form && 'formData' in form && form.formData) {
      const formData = form.formData as {
        displayName?: string;
        bio?: string;
        username?: string;
        isEmailPublic?: boolean;
        isUniversityPublic?: boolean;
        isFrequentingArcadePublic?: boolean;
        isStarredArcadePublic?: boolean;
      };
      displayName = formData.displayName || '';
      bio = formData.bio || '';
      username = formData.username || '';
      isEmailPublic = formData.isEmailPublic || false;
      isUniversityPublic = formData.isUniversityPublic !== false;
      isFrequentingArcadePublic = formData.isFrequentingArcadePublic || false;
      isStarredArcadePublic = formData.isStarredArcadePublic || false;
    }
  });

  // Clear client errors when server errors are received
  $effect(() => {
    if (form && 'fieldErrors' in form && form.fieldErrors) {
      clientErrors = {};
    }
  });

  // Field error helper
  const getFieldError = (field: string): string | undefined => {
    if (form && 'fieldErrors' in form && form.fieldErrors) {
      return (form.fieldErrors as Record<string, string>)[field];
    }
    return undefined;
  };

  // Check if field has error
  const hasFieldError = (field: string): boolean => {
    return !!getFieldError(field);
  };

  // Client-side validation state
  let clientErrors = $state<Record<string, string>>({});

  // Real-time validation
  const validateField = (field: string, value: string) => {
    switch (field) {
      case 'username':
        if (!value.trim()) {
          clientErrors.username = 'username_required';
        } else if (value.trim().length > 30) {
          clientErrors.username = 'username_too_long';
        } else if (!/^[A-Za-z0-9_-]+$/.test(value.trim())) {
          clientErrors.username = 'username_invalid';
        } else {
          delete clientErrors.username;
        }
        break;
      case 'displayName':
        if (value.trim().length > 50) {
          clientErrors.displayName = 'display_name_too_long';
        } else {
          delete clientErrors.displayName;
        }
        break;
      case 'bio':
        if (value.trim().length > 500) {
          clientErrors.bio = 'bio_too_long';
        } else {
          delete clientErrors.bio;
        }
        break;
    }
    clientErrors = { ...clientErrors }; // Trigger reactivity
  };

  // Get error for field (server or client)
  const getError = (field: string): string | undefined => {
    return getFieldError(field) || clientErrors[field];
  };

  // Check if field has any error (server or client)
  const hasError = (field: string): boolean => {
    return hasFieldError(field) || !!clientErrors[field];
  };

  // Check if form is valid
  let isFormValid = $derived.by(() => {
    const hasClientErrors = Object.keys(clientErrors).length > 0;
    const hasServerErrors =
      form && 'fieldErrors' in form && form.fieldErrors && Object.keys(form.fieldErrors).length > 0;
    const hasRequiredFields = username.trim().length > 0;
    return !hasClientErrors && !hasServerErrors && hasRequiredFields;
  });

  // Safe message getter for i18n
  const getMessage = (key: string | undefined): string => {
    if (!key) return '';

    // Handle common error message keys
    switch (key) {
      case 'username_required':
        return m.username_required();
      case 'username_too_long':
        return m.username_too_long();
      case 'username_invalid':
        return m.username_invalid();
      case 'username_taken':
        return m.username_taken();
      case 'display_name_too_long':
        return m.display_name_too_long();
      case 'bio_too_long':
        return m.bio_too_long();
      case 'profile_update_failed':
        return m.profile_update_failed();
      case 'profile_update_error':
        return m.profile_update_error();
      case 'profile_updated':
        return m.profile_updated();
      case 'validation_error':
        return m.validation_error();
      default:
        return key;
    }
  };
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold">{m.personal_settings()}</h1>
    <p class="text-base-content/70 mt-1">
      {m.manage_your_personal_information_and_preferences()}
    </p>
  </div>

  <!-- Success Alert -->
  {#if showSuccess || (form?.success && form?.message)}
    <div class="alert alert-success">
      <i class="fa-solid fa-check-circle"></i>
      <span>{form?.success ? getMessage(form.message) : m.profile_updated()}</span>
    </div>
  {/if}

  <!-- Error Alert -->
  {#if form?.message && !form.success}
    <div class="alert alert-error">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <span>{getMessage(form.message)}</span>
    </div>
  {/if}

  <!-- User Avatar & Basic Info -->
  {#if data.userProfile}
    <div class="bg-base-100 rounded-lg p-6">
      <div class="flex items-center gap-6">
        <div class="avatar">
          <div class="h-20 w-20 rounded-full">
            {#if data.userProfile.image}
              <img src={data.userProfile.image} alt={m.profile_image()} />
            {:else}
              <div
                class="bg-primary text-primary-content flex items-center justify-center text-2xl font-bold"
              >
                {data.userProfile.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
            {/if}
          </div>
        </div>
        <div>
          <h2 class="text-xl font-semibold">
            {getDisplayName(data.userProfile)}
          </h2>
          {#if data.userProfile.displayName && data.userProfile.name && data.userProfile.displayName !== data.userProfile.name}
            <p class="text-base-content/70">
              @{data.userProfile.name}
            </p>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Profile Form -->
  <form
    method="POST"
    action="?/updateProfile"
    use:enhance={() => {
      isSubmitting = true;

      return async ({ result }) => {
        isSubmitting = false;

        if (result.type === 'success' && result.data?.success) {
          showSuccess = true;
          invalidateAll();
          setTimeout(() => {
            showSuccess = false;
          }, 5000);
        }
      };
    }}
    class="bg-base-100 space-y-6 rounded-lg p-6"
  >
    <h3 class="text-lg font-semibold">{m.profile_information()}</h3>

    <!-- Display Name -->
    <div class="form-control">
      <label class="label" for="display-name">
        <span class="label-text">{m.display_name()}</span>
      </label>
      <input
        id="display-name"
        name="displayName"
        type="text"
        bind:value={displayName}
        oninput={() => validateField('displayName', displayName)}
        placeholder={m.enter_your_display_name()}
        class="input input-bordered w-full"
        class:input-error={hasError('displayName')}
        maxlength="50"
      />
      <div class="label">
        {#if hasError('displayName')}
          <span class="label-text-alt text-error">
            <i class="fa-solid fa-exclamation-triangle mr-1"></i>
            {getMessage(getError('displayName'))}
          </span>
        {:else}
          <span class="label-text-alt text-base-content/50">
            {m.this_is_how_others_will_see_your_name()}
          </span>
        {/if}
      </div>
    </div>

    <!-- Username -->
    <div class="form-control">
      <label class="label" for="username">
        <span class="label-text">{m.username()}</span>
        <span class="label-text-alt text-error">*</span>
      </label>
      <input
        id="username"
        name="username"
        type="text"
        bind:value={username}
        oninput={() => validateField('username', username)}
        placeholder={m.username()}
        class="input input-bordered w-full"
        class:input-error={hasError('username')}
        pattern="[A-Za-z0-9_\-]+"
        title={m.username_requirements()}
        maxlength="30"
        required
      />
      <div class="label">
        {#if hasError('username')}
          <span class="label-text-alt text-error">
            <i class="fa-solid fa-exclamation-triangle mr-1"></i>
            {getMessage(getError('username'))}
          </span>
        {:else}
          <span class="label-text-alt text-base-content/60">
            {m.username_requirements()}
          </span>
        {/if}
      </div>
    </div>

    <!-- Bio -->
    <div class="form-control">
      <label class="label" for="bio">
        <span class="label-text">{m.bio()}</span>
      </label>
      <textarea
        id="bio"
        name="bio"
        bind:value={bio}
        oninput={() => validateField('bio', bio)}
        placeholder={m.tell_us_about_yourself()}
        class="textarea textarea-bordered h-24 w-full"
        class:textarea-error={hasError('bio')}
        maxlength="500"
      ></textarea>
      <div class="label">
        {#if hasError('bio')}
          <span class="label-text-alt text-error">
            <i class="fa-solid fa-exclamation-triangle mr-1"></i>
            {getMessage(getError('bio'))}
          </span>
        {:else}
          <span class="label-text-alt {bio.length > 450 ? 'text-warning' : 'text-base-content/50'}">
            {bio.length}/500 {m.characters()}
          </span>
        {/if}
      </div>
    </div>

    <div class="divider">{m.privacy_settings()}</div>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <!-- Email Visibility -->
      <div class="form-control">
        <label class="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            name="isEmailPublic"
            class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
            bind:checked={isEmailPublic}
          />
          <div>
            <span class="text-base-content">{m.email_visibility()}</span>
            <div class="text-base-content/60 text-xs">{m.email_public()}</div>
          </div>
        </label>
      </div>

      <!-- University Visibility -->
      <div class="form-control">
        <label class="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            name="isUniversityPublic"
            class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
            bind:checked={isUniversityPublic}
          />
          <div>
            <span class="text-base-content">{m.university_visibility()}</span>
            <div class="text-base-content/60 text-xs">{m.university_public()}</div>
          </div>
        </label>
      </div>

      <!-- Frequenting Arcades Visibility -->
      <div class="form-control">
        <label class="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            name="isFrequentingArcadePublic"
            class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
            bind:checked={isFrequentingArcadePublic}
          />
          <div>
            <span class="text-base-content">{m.frequenting_arcades_visibility()}</span>
            <div class="text-base-content/60 text-xs">{m.frequenting_arcades_public()}</div>
          </div>
        </label>
      </div>

      <!-- Starred Arcades Visibility -->
      <div class="form-control">
        <label class="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            name="isStarredArcadePublic"
            class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
            bind:checked={isStarredArcadePublic}
          />
          <div>
            <span class="text-base-content">{m.starred_arcades_visibility()}</span>
            <div class="text-base-content/60 text-xs">{m.starred_arcades_public()}</div>
          </div>
        </label>
      </div>
    </div>

    <!-- Submit Button -->
    <div class="flex justify-end">
      <button type="submit" class="btn btn-primary" disabled={isSubmitting || !isFormValid}>
        {#if isSubmitting}
          <span class="loading loading-spinner loading-sm"></span>
        {:else}
          <i class="fa-solid fa-save"></i>
        {/if}
        {m.save_profile()}
      </button>
    </div>
  </form>
</div>
