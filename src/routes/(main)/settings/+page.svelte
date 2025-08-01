<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let isSubmitting = $state(false);
  let showSuccess = $state(false);

  // Form data
  let displayName = $state(data.userProfile?.displayName || '');
  let bio = $state(data.userProfile?.bio || '');
  let username = $state(data.userProfile?.name || '');
  let isEmailPublic = $state(data.userProfile?.isEmailPublic || false);
  let isUniversityPublic = $state(data.userProfile?.isUniversityPublic !== false);
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
  {#if showSuccess}
    <div class="alert alert-success">
      <i class="fa-solid fa-check-circle"></i>
      <span>{m.profile_updated()}</span>
    </div>
  {/if}

  <!-- Error Alert -->
  {#if form?.message && !form.success}
    <div class="alert alert-error">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <span>{form.message}</span>
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
            {data.userProfile.displayName || `@${data.userProfile.name}`}
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

        if (result.type === 'success') {
          showSuccess = true;
          invalidateAll();
          setTimeout(() => {
            showSuccess = false;
          }, 3000);
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
        placeholder={m.enter_your_display_name()}
        class="input input-bordered w-full"
        maxlength="50"
      />
      <div class="label">
        <span class="label-text-alt text-base-content/50">
          {m.this_is_how_others_will_see_your_name()}
        </span>
      </div>
    </div>

    <!-- Username -->
    <div class="form-control">
      <label class="label" for="username">
        <span class="label-text">{m.username()}</span>
      </label>
      <input
        id="username"
        name="username"
        type="text"
        bind:value={username}
        placeholder={m.username()}
        class="input input-bordered w-full"
        pattern="[A-Za-z0-9_\-]+"
        title={m.username_requirements()}
        maxlength="30"
        required
      />
      <div class="label-text-alt text-base-content/60 mt-1">
        {m.username_requirements()}
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
        placeholder={m.tell_us_about_yourself()}
        class="textarea textarea-bordered h-24 w-full"
        maxlength="500"
      ></textarea>
      <div class="label">
        <span class="label-text-alt text-base-content/50">
          {bio.length}/500 {m.characters()}
        </span>
      </div>
    </div>

    <div class="divider">{m.privacy_settings()}</div>

    <div class="space-y-3">
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
    </div>

    <!-- Submit Button -->
    <div class="flex justify-end">
      <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
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
