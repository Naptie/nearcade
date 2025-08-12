<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { PostReadability, PostWritability } from '$lib/types';
  import { buildPageTitle } from '$lib/utils';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let isSubmitting = $state(false);
  let errors = $state<string[]>([]);

  // Form data initialized from existing club data
  let name = $state(data.club.name);
  let slug = $state(data.club.slug || '');
  let description = $state(data.club.description || '');
  let website = $state(data.club.website || '');
  let avatarUrl = $state(data.club.avatarUrl || '');
  let backgroundColor = $state(data.club.backgroundColor || '#3b82f6');
  let acceptJoinRequests = $state(data.club.acceptJoinRequests);
  let postReadability = $state(data.club.postReadability);
  let postWritability = $state(data.club.postWritability);

  // Track whether user wants to set a custom background color
  let useCustomBackgroundColor = $state(!!data.club.backgroundColor);
</script>

<svelte:head>
  <title>{buildPageTitle(`${m.edit()} ${m.club()}`, data.club.name)}</title>
  <meta name="description" content="{m.edit()} {m.club()} - {data.club.name}" />
</svelte:head>

<div class="mx-auto max-w-4xl px-4 pt-20 sm:px-6 lg:px-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl font-bold">{m.edit()} {m.club()}</h1>
    <p class="text-base-content/70 mt-2">
      {data.club.name}
    </p>
  </div>

  <!-- Success Alert -->
  {#if form?.success}
    <div class="alert alert-success mb-6">
      <i class="fa-solid fa-check-circle"></i>
      <span>{form.message}</span>
    </div>
  {/if}

  <!-- Error Alert -->
  {#if (form?.message && !form.success) || errors.length > 0}
    <div class="alert alert-error mb-6">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <div>
        {#if form?.message && !form.success}
          <div class="font-medium">{form.message}</div>
        {/if}
        {#if errors.length > 0}
          <div class="mt-2">
            <div class="text-sm font-medium">{m.form_errors_found()}</div>
            <ul class="mt-1 list-inside list-disc text-sm">
              {#each errors as error (error)}
                <li>{error}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Edit Club Form -->
  <form
    method="POST"
    use:enhance={() => {
      isSubmitting = true;
      return async ({ result }) => {
        isSubmitting = false;
        if (result.type === 'success') {
          goto(`${base}/clubs/${slug}`);
        } else if (result.type === 'failure') {
          errors = (result.data?.errors as string[]) || [];

          // Restore form data if available
          if (result.data?.formData) {
            const fd = result.data.formData as {
              name?: string;
              slug?: string;
              description?: string;
              website?: string;
              avatarUrl?: string;
              backgroundColor?: string;
              useCustomBackgroundColor?: boolean;
              acceptJoinRequests?: boolean;
              postReadability?: PostReadability;
              postWritability?: PostWritability;
            };
            name = fd.name || name;
            slug = fd.slug || slug;
            description = fd.description || description;
            website = fd.website || website;
            avatarUrl = fd.avatarUrl || avatarUrl;
            backgroundColor = fd.backgroundColor || backgroundColor;
            useCustomBackgroundColor = fd.useCustomBackgroundColor ?? useCustomBackgroundColor;
            acceptJoinRequests = fd.acceptJoinRequests ?? acceptJoinRequests;
            postReadability = fd.postReadability || postReadability;
            postWritability = fd.postWritability || postWritability;
          }
        }
      };
    }}
    class="space-y-8"
  >
    <!-- Basic Information -->
    <div class="bg-base-200 rounded-lg p-6">
      <h2 class="mb-6 text-xl font-semibold">{m.basic_information()}</h2>

      <div class="grid gap-6 md:grid-cols-2">
        <!-- Club Name -->
        <div class="form-control md:col-span-2">
          <label class="label" for="name">
            <span class="label-text">{m.club_name()}</span>
            <span class="label-text-alt text-error">*</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            bind:value={name}
            placeholder={m.enter_club_name()}
            class="input input-bordered w-full"
            required
            maxlength="100"
          />
          <div class="label">
            <span class="label-text-alt text-base-content/50">
              {name.length}/100 {m.characters()}
            </span>
          </div>
        </div>

        <!-- Club Slug -->
        <div class="form-control">
          <label class="label" for="slug">
            <span class="label-text">{m.slug()}</span>
            <span class="label-text-alt text-error">*</span>
          </label>
          <input
            id="slug"
            name="slug"
            type="text"
            bind:value={slug}
            placeholder="awesome-club"
            class="input input-bordered w-full"
            pattern="[a-z0-9\-]+"
            title={m.slug_help()}
            required
            maxlength="50"
          />
          <div class="label">
            <span class="label-text-alt text-base-content/60 text-xs">
              {#if slug}
                {m.club_slug_hint({ slug })}
              {:else}
                {m.slug_help()}
              {/if}
            </span>
          </div>
        </div>

        <!-- Background Color -->
        <div class="form-control">
          <label class="label relative cursor-pointer gap-2">
            <input
              type="checkbox"
              class="checkbox checkbox-xs hover:checkbox-primary checked:checkbox-primary absolute left-0 transition"
              bind:checked={useCustomBackgroundColor}
            />
            <span class="label-text pl-6">{m.club_background_color()}</span>
          </label>
          {#if useCustomBackgroundColor}
            <input
              id="club-background"
              name="backgroundColor"
              type="color"
              bind:value={backgroundColor}
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

        <!-- Club Description -->
        <div class="form-control md:col-span-2">
          <label class="label" for="description">
            <span class="label-text">{m.description()}</span>
          </label>
          <textarea
            id="description"
            name="description"
            bind:value={description}
            placeholder={m.enter_club_description()}
            class="textarea textarea-bordered h-32 w-full rounded-xl"
            maxlength="1000"
          ></textarea>
          <div class="label">
            <span class="label-text-alt text-base-content/50">
              {description.length}/1000 {m.characters()}
            </span>
          </div>
        </div>

        <!-- Website -->
        <div class="form-control">
          <label class="label" for="website">
            <span class="label-text">{m.website()}</span>
          </label>
          <input
            id="website"
            name="website"
            type="url"
            bind:value={website}
            placeholder={m.enter_website_url()}
            class="input input-bordered w-full"
            maxlength="200"
          />
        </div>

        <!-- Avatar URL -->
        <div class="form-control">
          <label class="label" for="avatarUrl">
            <span class="label-text">{m.club_avatar()}</span>
          </label>
          <input
            id="avatarUrl"
            name="avatarUrl"
            type="url"
            bind:value={avatarUrl}
            placeholder={m.placeholder_avatar_url()}
            class="input input-bordered w-full"
            maxlength="500"
          />
        </div>
      </div>
    </div>

    <!-- Club Settings -->
    <div class="bg-base-200 rounded-lg p-6">
      <h2 class="mb-6 text-xl font-semibold">{m.club_settings()}</h2>

      <div class="space-y-6">
        <!-- Post Readability -->
        <div class="form-control">
          <label class="label" for="postReadability">
            <span class="label-text">{m.post_readability()}</span>
          </label>
          <select
            id="postReadability"
            name="postReadability"
            bind:value={postReadability}
            class="select select-bordered w-full"
          >
            <option value={PostReadability.PUBLIC}>{m.public()}</option>
            <option value={PostReadability.UNIV_MEMBERS}>{m.university_members()}</option>
            <option value={PostReadability.CLUB_MEMBERS}>{m.club_members()}</option>
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
            bind:value={postWritability}
            class="select select-bordered w-full"
          >
            <option value={PostWritability.PUBLIC}>{m.public()}</option>
            <option value={PostWritability.UNIV_MEMBERS}>{m.university_members()}</option>
            <option value={PostWritability.CLUB_MEMBERS}>{m.club_members()}</option>
            <option value={PostWritability.ADMINS_AND_MODS}>{m.admins_and_mods()}</option>
          </select>
        </div>

        <!-- Accept Join Requests -->
        <div class="form-control">
          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              name="acceptJoinRequests"
              class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
              bind:checked={acceptJoinRequests}
            />
            <div>
              <span class="label-text">{m.accept_join_requests()}</span>
              <div class="text-base-content/60 text-xs">
                {m.accept_join_requests_description()}
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>

    <!-- Submit Button -->
    <div class="flex justify-end gap-4">
      <a href="{base}/clubs/{data.club.slug || data.club.id}" class="btn btn-ghost">
        {m.cancel()}
      </a>
      <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
        {#if isSubmitting}
          <span class="loading loading-spinner loading-sm"></span>
        {:else}
          <i class="fa-solid fa-save"></i>
        {/if}
        {m.save_changes()}
      </button>
    </div>
  </form>
</div>
