<script lang="ts">
  import { enhance } from '$app/forms';
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { PostReadability, PostWritability } from '$lib/types';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData | null } = $props();

  let isSubmitting = $state(false);

  // Form data
  let name = $state('');
  let slug = $state('');
  let description = $state('');
  let website = $state('');
  let avatarUrl = $state('');
  let backgroundColor = $state('#3b82f6');
  let acceptJoinRequests = $state(true);
  let postReadability = $state('public');
  let postWritability = $state('all_members');

  // Auto-generate slug from name
  $effect(() => {
    if (name && !slug) {
      slug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-_]/g, '')
        .replace(/\s+/g, '-')
        .replace(/--+/g, '-')
        .trim();
    }
  });
</script>

<svelte:head>
  <title>{m.create_club()} - {m.app_name()}</title>
  <meta name="description" content={m.create_club()} />
</svelte:head>

<div class="mx-auto max-w-4xl px-4 pt-20 sm:px-6 lg:px-8">
  <!-- Header -->
  <div class="mb-8">
    <h1 class="text-3xl font-bold">{m.create_club()}</h1>
    {#if data.university}
      <p class="text-base-content/70 mt-2">
        {m.creating_club_for({ university: data.university.name })}
      </p>
    {/if}
  </div>

  <!-- Error Alert -->
  {#if form?.message}
    <div class="alert alert-error mb-6">
      <i class="fa-solid fa-exclamation-triangle"></i>
      <span>{form.message}</span>
    </div>
  {/if}

  <!-- Create Club Form -->
  <form
    method="POST"
    use:enhance={() => {
      isSubmitting = true;
      return () => {
        isSubmitting = false;
      };
    }}
    class="space-y-8"
  >
    <!-- Hidden university ID -->
    <input type="hidden" name="universityId" value={data.university?.id || ''} />

    <!-- Basic Information -->
    <div class="bg-base-200 rounded-lg p-6">
      <h2 class="mb-6 text-xl font-semibold">{m.basic_information()}</h2>

      <div class="grid gap-6 md:grid-cols-2">
        <!-- Club Name -->
        <div class="form-control md:col-span-2">
          <label class="label" for="name">
            <span class="label-text">{m.club_name()}</span>
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
        </div>

        <!-- Club Slug -->
        <div class="form-control">
          <label class="label" for="slug">
            <span class="label-text">{m.slug()}</span>
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
              {m.slug_help()}
            </span>
          </div>
        </div>

        <!-- Background Color -->
        <div class="form-control">
          <label class="label" for="backgroundColor">
            <span class="label-text">{m.club_background_color()}</span>
          </label>
          <input
            id="backgroundColor"
            name="backgroundColor"
            type="color"
            bind:value={backgroundColor}
            class="input input-bordered h-12 w-full"
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
      <a href="{base}/universities/{data.university?.id}" class="btn btn-ghost">
        {m.cancel()}
      </a>
      <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
        {#if isSubmitting}
          <span class="loading loading-spinner loading-sm"></span>
        {:else}
          <i class="fa-solid fa-plus"></i>
        {/if}
        {m.create_club()}
      </button>
    </div>
  </form>
</div>
