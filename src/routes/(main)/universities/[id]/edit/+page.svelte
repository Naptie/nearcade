<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { goto, invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import { resolve } from '$app/paths';
  import { PostReadability, PostWritability } from '$lib/types';
  import { pageTitle } from '$lib/utils';

  let { data }: { data: PageData } = $props();

  let isSubmitting = $state(false);
  let errorMessage = $state('');
  let errors = $state<string[]>([]);

  // Form data
  let formData = $state({
    name: data.university.name,
    type: data.university.type,
    majorCategory: data.university.majorCategory || '',
    natureOfRunning: data.university.natureOfRunning || '',
    affiliation: data.university.affiliation,
    is985: data.university.is985 || false,
    is211: data.university.is211 || false,
    isDoubleFirstClass: data.university.isDoubleFirstClass || false,
    description: data.university.description || '',
    website: data.university.website || '',
    avatarUrl: data.university.avatarUrl || '',
    backgroundColor: data.university.backgroundColor || '#3b82f6',
    slug: data.university.slug || '',
    postReadability: data.university.postReadability || PostReadability.PUBLIC,
    postWritability: data.university.postWritability || PostWritability.UNIV_MEMBERS
  });

  // Track whether user wants to set a custom background color
  let useCustomBackgroundColor = $state(!!data.university.backgroundColor);

  const handleCancel = () => {
    goto(resolve('/(main)/universities/[id]', { id: data.university.slug || data.university.id }));
  };
</script>

<svelte:head>
  <title>{pageTitle(m.edit_university_info(), data.university.name)}</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8 pt-20 sm:px-6 lg:px-8">
  <!-- Header -->
  <div class="mb-8">
    <div>
      <h1 class="text-3xl font-bold">{m.edit_university_info()}</h1>
      <p class="text-base-content/60">{data.university.name}</p>
    </div>
  </div>

  <!-- Error Alert -->
  {#if errorMessage || errors.length > 0}
    <div class="alert alert-error mb-6">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <div>
        {#if errorMessage}
          <div class="font-medium">{errorMessage}</div>
        {/if}
        {#if errors.length > 0}
          <div class="mt-2">
            <div class="text-sm font-medium">{m.form_errors_found()}</div>
            <ul class="mt-1 list-inside list-disc text-sm">
              {#each errors as error, index (index)}
                <li>{error}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Form -->
  <form
    method="POST"
    action="?/updateUniversity"
    use:enhance={() => {
      isSubmitting = true;
      return async ({ result }) => {
        isSubmitting = false;

        if (result.type === 'redirect') {
          await invalidateAll();
          goto(result.location);
        } else if (result.type === 'failure') {
          errorMessage = (result.data?.message as string) || m.form_validation_error();
          errors = (result.data?.errors as string[]) || [];

          // Restore form data if available
          if (result.data?.formData) {
            formData = { ...formData, ...result.data.formData };
            useCustomBackgroundColor =
              (
                result.data.formData as {
                  useCustomBackgroundColor?: boolean;
                }
              ).useCustomBackgroundColor ?? useCustomBackgroundColor;
          }
        } else if (result.type === 'error') {
          errorMessage = m.failed_to_update();
          errors = [];
        }
      };
    }}
    class="space-y-6"
  >
    <div class="bg-base-200 rounded-lg p-6">
      <h2 class="mb-4 text-xl font-semibold">{m.basic_information()}</h2>

      <div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <!-- University Name -->
        <div class="form-control sm:col-span-2">
          <label class="label" for="university-name">
            <span class="label-text">{m.name()}</span>
            <span class="label-text-alt text-error">*</span>
          </label>
          <input
            id="university-name"
            name="name"
            type="text"
            bind:value={formData.name}
            class="input input-bordered w-full"
            required
            maxlength="200"
          />
        </div>

        <!-- University Type -->
        <div class="form-control">
          <label class="label" for="university-type">
            <span class="label-text">{m.university_type()}</span>
            <span class="label-text-alt text-error">*</span>
          </label>
          <input
            id="university-type"
            name="type"
            type="text"
            bind:value={formData.type}
            placeholder={m.university_type_placeholder()}
            class="input input-bordered w-full"
            required
          />
        </div>

        <!-- Affiliation -->
        <div class="form-control">
          <label class="label" for="university-affiliation">
            <span class="label-text">{m.university_affiliation()}</span>
            <span class="label-text-alt text-error">*</span>
          </label>
          <input
            id="university-affiliation"
            name="affiliation"
            type="text"
            bind:value={formData.affiliation}
            placeholder={m.university_affiliation_placeholder()}
            class="input input-bordered w-full"
            required
          />
        </div>

        <!-- Major Category -->
        <div class="form-control">
          <label class="label" for="university-major-category">
            <span class="label-text">{m.university_major_category()}</span>
          </label>
          <input
            id="university-major-category"
            name="majorCategory"
            type="text"
            bind:value={formData.majorCategory}
            placeholder={m.university_major_category_placeholder()}
            class="input input-bordered w-full"
          />
        </div>

        <!-- Nature of Running -->
        <div class="form-control">
          <label class="label" for="university-nature">
            <span class="label-text">{m.university_nature_of_running()}</span>
          </label>
          <input
            id="university-nature"
            name="natureOfRunning"
            type="text"
            bind:value={formData.natureOfRunning}
            placeholder={m.university_nature_of_running_placeholder()}
            class="input input-bordered w-full"
          />
        </div>

        <!-- Custom URL Slug -->
        <div class="form-control">
          <label class="label" for="university-slug">
            <span class="label-text">{m.slug()}</span>
          </label>
          <input
            id="university-slug"
            name="slug"
            type="text"
            bind:value={formData.slug}
            placeholder={m.slug_help()}
            class="input input-bordered w-full"
          />
          <div class="label whitespace-normal">
            <span class="label-text-alt">
              {#if formData.slug}
                {m.university_slug_hint({ slug: formData.slug })}
              {:else}
                {m.slug_help()}
              {/if}
            </span>
          </div>
        </div>

        <!-- Website -->
        <div class="form-control">
          <label class="label" for="university-website">
            <span class="label-text">{m.official_website()}</span>
          </label>
          <input
            id="university-website"
            name="website"
            type="url"
            bind:value={formData.website}
            placeholder={m.website_placeholder()}
            class="input input-bordered w-full"
          />
        </div>

        <!-- Avatar URL -->
        <div class="form-control">
          <label class="label" for="university-avatar">
            <span class="label-text">{m.avatar_url()}</span>
          </label>
          <input
            id="university-avatar"
            name="avatarUrl"
            type="url"
            bind:value={formData.avatarUrl}
            placeholder={m.logo_placeholder()}
            class="input input-bordered w-full"
          />
        </div>

        <!-- Background Color -->
        <div class="form-control">
          <label class="label relative cursor-pointer gap-2">
            <input
              type="checkbox"
              class="checkbox checkbox-xs hover:checkbox-primary checked:checkbox-primary absolute left-0 transition"
              bind:checked={useCustomBackgroundColor}
            />
            <span class="label-text pl-6">{m.university_background_color()}</span>
          </label>
          {#if useCustomBackgroundColor}
            <input
              id="university-background"
              name="backgroundColor"
              type="color"
              bind:value={formData.backgroundColor}
              class="input input-bordered w-full"
            />
          {/if}
          <!-- Hidden input to track if user wants to set background color -->
          <input
            type="hidden"
            name="useCustomBackgroundColor"
            value={useCustomBackgroundColor ? 'true' : 'false'}
          />
        </div>
      </div>

      <!-- University Classification -->
      <div class="mt-6">
        <h3 class="mb-4 text-lg font-medium">{m.university_classification()}</h3>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <!-- 985 Project -->
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                name="is985"
                class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
                bind:checked={formData.is985}
              />
              <span class="label-text">{m.badge_985()}</span>
            </label>
          </div>

          <!-- 211 Project -->
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                name="is211"
                class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
                bind:checked={formData.is211}
              />
              <span class="label-text">{m.badge_211()}</span>
            </label>
          </div>

          <!-- Double First-Class -->
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                name="isDoubleFirstClass"
                class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
                bind:checked={formData.isDoubleFirstClass}
              />
              <span class="label-text">{m.badge_double_first_class()}</span>
            </label>
          </div>
        </div>
      </div>

      <!-- Description -->
      <div class="form-control mt-6">
        <label class="label" for="university-description">
          <span class="label-text">{m.description()}</span>
        </label>
        <textarea
          id="university-description"
          name="description"
          bind:value={formData.description}
          placeholder={m.school_introduction()}
          class="textarea textarea-bordered w-full rounded-xl"
          rows="4"
          maxlength="2000"
        ></textarea>
        <div class="label">
          <span class="label-text-alt text-base-content/50">
            {formData.description.length}/2000 {m.characters()}
          </span>
        </div>
      </div>
    </div>

    <!-- University Settings -->
    <div class="bg-base-200 rounded-lg p-6">
      <h2 class="mb-6 text-xl font-semibold">{m.university_settings()}</h2>

      <div class="space-y-6">
        <!-- Post Readability -->
        <div class="form-control">
          <label class="label" for="postReadability">
            <span class="label-text">{m.post_readability()}</span>
          </label>
          <select
            id="postReadability"
            name="postReadability"
            bind:value={formData.postReadability}
            class="select select-bordered w-full"
          >
            <option value={PostReadability.PUBLIC}>{m.public()}</option>
            <option value={PostReadability.UNIV_MEMBERS}>{m.university_members()}</option>
          </select>
        </div>

        <!-- Post Writability -->
        <div class="form-control">
          <label class="label" for="postWritability">
            <span class="label-text">{m.post_writability()}</span>
          </label>
          <select
            id="postWritability"
            name="postWritability"
            bind:value={formData.postWritability}
            class="select select-bordered w-full"
          >
            <option value={PostWritability.PUBLIC}>{m.public()}</option>
            <option value={PostWritability.UNIV_MEMBERS}>{m.university_members()}</option>
            <option value={PostWritability.ADMINS_AND_MODS}>{m.admins_and_mods()}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Form Actions -->
    <div class="flex justify-end gap-4">
      <button type="button" class="btn btn-ghost" onclick={handleCancel} disabled={isSubmitting}>
        {m.cancel()}
      </button>
      <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
        {#if isSubmitting}
          <span class="loading loading-spinner loading-sm"></span>
          {m.saving()}
        {:else}
          <i class="fa-solid fa-save"></i>
          {m.save_profile()}
        {/if}
      </button>
    </div>
  </form>
</div>
