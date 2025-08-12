<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { base } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { formatDate, getUserTypeLabel, buildPageTitle } from '$lib/utils';
  import { signOut } from '@auth/sveltekit/client';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let showDeleteConfirm = $state(false);
  let showLeaveUniversityConfirm = $state(false);
  let showLeaveClubConfirm = $state(false);
  let leavingUniversityId = $state('');
  let leavingClubId = $state('');

  const confirmLeaveUniversity = (universityId: string) => {
    leavingUniversityId = universityId;
    showLeaveUniversityConfirm = true;
  };

  const confirmLeaveClub = (clubId: string) => {
    leavingClubId = clubId;
    showLeaveClubConfirm = true;
  };
</script>

<svelte:head>
  <title>{buildPageTitle(m.account_settings())}</title>
</svelte:head>

<div class="container mx-auto px-4 py-8">
  <div class="mb-6">
    <h1 class="mb-2 text-3xl font-bold">{m.account_settings()}</h1>
    <p class="text-base-content/70">
      {m.manage_account_and_associations()}
    </p>
  </div>

  <!-- Account Information -->
  <div class="bg-base-200 mb-6 rounded-lg p-6">
    <h2 class="mb-4 text-xl font-semibold">{m.account_information()}</h2>

    {#if data.userProfile}
      {@const profile = data.userProfile}
      <div class="grid gap-6 md:grid-cols-2">
        <!-- Profile Picture -->

        <div class="flex items-center gap-4">
          <div class="avatar">
            <div class="h-16 w-16 rounded-full">
              {#if profile.image}
                <img src={profile.image} alt={profile.name} />
              {:else}
                <div
                  class="bg-neutral text-neutral-content flex items-center justify-center text-xl"
                >
                  {profile.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
              {/if}
            </div>
          </div>
          <div>
            <h3 class="font-medium">@{profile.name}</h3>
            {#if profile.email && !profile.email.endsWith('.nearcade')}
              <p class="text-base-content/60 text-sm">{profile.email}</p>
            {/if}
            <p class="text-base-content/50 text-xs">{getUserTypeLabel(profile.userType)}</p>
          </div>
        </div>

        <!-- Account Details -->
        <div class="space-y-3">
          <div class="flex justify-between">
            <span class="text-base-content/70">{m.user_id()}</span>
            <span class="font-mono text-sm">{profile.id}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/70">{m.account_created()}</span>
            <span>{formatDate(profile.joinedAt)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-base-content/70">{m.last_active()}</span>
            <span>{formatDate(profile.lastActiveAt)}</span>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- University Association -->
  <div class="bg-base-200 mb-6 rounded-lg p-6">
    <h2 class="mb-4 text-xl font-semibold">{m.university_associations()}</h2>

    {#if data.universities && data.universities.length > 0}
      <div class="space-y-3">
        {#each data.universities as university (university.id)}
          <div class="bg-base-100 flex items-center justify-between rounded-lg p-4">
            <a
              href="{base}/universities/{university.slug || university.id}"
              class="group flex cursor-pointer items-center gap-3"
            >
              <div class="avatar {university.avatarUrl ? '' : 'avatar-placeholder'}">
                <div
                  class="h-10 w-10 rounded-full {university.avatarUrl
                    ? 'bg-white'
                    : 'bg-neutral text-neutral-content'}"
                >
                  {#if university.avatarUrl}
                    <img src={university.avatarUrl} alt={university.name} />
                  {:else}
                    <span class="text-base">{university.name?.charAt(0)?.toUpperCase() || '?'}</span
                    >
                  {/if}
                </div>
              </div>
              <div class="group-hover:text-accent transition-colors">
                <h3 class="font-medium">{university.name}</h3>
                <p class="text-sm opacity-60">{university.type}</p>
              </div>
            </a>
            <button
              class="btn btn-outline btn-error btn-sm"
              onclick={() => confirmLeaveUniversity(university.id)}
            >
              <i class="fa-solid fa-sign-out-alt"></i>
              {m.leave_university()}
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="text-base-content/60 py-8 text-center">
        <i class="fa-solid fa-graduation-cap mb-2 text-2xl"></i>
        <p>{m.not_associated_with_university()}</p>
        <a href="{base}/universities" class="btn btn-primary btn-sm mt-2">
          <i class="fa-solid fa-search"></i>
          {m.find_university()}
        </a>
      </div>
    {/if}
  </div>

  <!-- Club Memberships -->
  <div class="bg-base-200 mb-6 rounded-lg p-6">
    <h2 class="mb-4 text-xl font-semibold">{m.club_memberships()}</h2>

    {#if data.clubs && data.clubs.length > 0}
      <div class="space-y-3">
        {#each data.clubs as club (club.id)}
          <div class="bg-base-100 flex items-center justify-between rounded-lg p-4">
            <div class="flex items-center gap-3">
              <div class="avatar {club.avatarUrl ? '' : 'avatar-placeholder'}">
                <div
                  class="h-10 w-10 rounded-full {club.avatarUrl
                    ? ''
                    : 'bg-neutral text-neutral-content'}"
                >
                  {#if club.avatarUrl}
                    <img src={club.avatarUrl} alt={club.name} />
                  {:else}
                    <span class="text-base">{club.name?.charAt(0)?.toUpperCase() || '?'}</span>
                  {/if}
                </div>
              </div>
              <div>
                <h3 class="font-medium">
                  <a href="{base}/clubs/{club.id}" class="hover:text-accent transition-colors">
                    {club.name}
                  </a>
                </h3>
                {#if club.university}
                  <a
                    href="{base}/universities/{club.university.slug || club.university.id}"
                    class="hover:text-accent text-base-content/60 text-sm transition-colors"
                    >{club.university.name}</a
                  >
                {/if}
              </div>
            </div>
            <button
              class="btn btn-outline btn-error btn-sm"
              onclick={() => confirmLeaveClub(club.id)}
            >
              <i class="fa-solid fa-sign-out-alt"></i>
              {m.leave_club()}
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="text-base-content/60 py-8 text-center">
        <i class="fa-solid fa-users mb-2 text-2xl"></i>
        <p>{m.not_member_of_any_clubs()}</p>
        <a href="{base}/clubs" class="btn btn-primary btn-sm mt-2">
          <i class="fa-solid fa-search"></i>
          {m.find_clubs()}
        </a>
      </div>
    {/if}
  </div>

  <!-- Danger Zone -->
  <div class="bg-error/10 border-error/20 rounded-lg border p-6">
    <h2 class="text-error mb-4 text-xl font-semibold">{m.danger_zone()}</h2>

    <div class="space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-error font-medium">{m.delete_account()}</h3>
          <p class="text-base-content/60 text-sm">{m.delete_account_warning()}</p>
        </div>
        <button class="btn btn-error btn-sm" onclick={() => (showDeleteConfirm = true)}>
          <i class="fa-solid fa-trash"></i>
          {m.delete_account()}
        </button>
      </div>
    </div>
  </div>
</div>

<!-- Leave University Confirmation Modal -->
<div class="modal" class:modal-open={showLeaveUniversityConfirm}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.leave_university()}</h3>
    <p class="py-4">{m.confirm_leave_university()}</p>
    <div class="modal-action">
      <button
        class="btn btn-ghost"
        onclick={() => {
          showLeaveUniversityConfirm = false;
          leavingUniversityId = '';
        }}
      >
        {m.cancel()}
      </button>
      <form
        method="POST"
        action="?/leaveUniversity"
        use:enhance={() => {
          showLeaveUniversityConfirm = false;
          leavingUniversityId = '';
          return async ({ result }) => {
            if (result.type === 'success') {
              invalidateAll();
            }
          };
        }}
      >
        <input type="hidden" name="universityId" value={leavingUniversityId} />
        <button type="submit" class="btn btn-error btn-soft">
          {m.leave()}
        </button>
      </form>
    </div>
  </div>
</div>

<!-- Leave Club Confirmation Modal -->
<div class="modal" class:modal-open={showLeaveClubConfirm}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.leave_club()}</h3>
    <p class="py-4">{m.confirm_leave_club()}</p>
    <div class="modal-action">
      <button
        class="btn btn-ghost"
        onclick={() => {
          showLeaveClubConfirm = false;
          leavingClubId = '';
        }}
      >
        {m.cancel()}
      </button>
      <form
        method="POST"
        action="?/leaveClub"
        use:enhance={() => {
          showLeaveClubConfirm = false;
          leavingClubId = '';
          return async ({ result }) => {
            if (result.type === 'success') {
              invalidateAll();
            }
          };
        }}
      >
        <input type="hidden" name="clubId" value={leavingClubId} />
        <button type="submit" class="btn btn-error btn-soft">
          {m.leave()}
        </button>
      </form>
    </div>
  </div>
</div>

<!-- Delete Account Confirmation Modal -->
<div class="modal" class:modal-open={showDeleteConfirm}>
  <div class="modal-box">
    <h3 class="text-error text-lg font-bold">{m.delete_account()}</h3>
    <p class="py-4">{m.confirm_delete_account()}</p>
    <div class="alert alert-error mb-4">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>{m.delete_account_irreversible()}</span>
    </div>
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={() => (showDeleteConfirm = false)}>
        {m.cancel()}
      </button>
      <form
        method="POST"
        action="?/deleteAccount"
        use:enhance={() => {
          showDeleteConfirm = false;
          return async ({ result }) => {
            if (result.type === 'success') {
              await signOut({ redirectTo: `${base}/` });
            }
          };
        }}
      >
        <button type="submit" class="btn btn-error btn-soft">
          <i class="fa-solid fa-trash"></i>
          {m.delete_permanently()}
        </button>
      </form>
    </div>
  </div>
</div>
