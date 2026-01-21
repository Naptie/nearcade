<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { base, resolve } from '$app/paths';
  import { page } from '$app/state';
  import { m } from '$lib/paraglide/messages';
  import { formatDate, getProviders, getUserTypeLabel, pageTitle } from '$lib/utils';
  import { signIn, signOut } from '@auth/sveltekit/client';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let showDeleteConfirm = $state(false);
  let showLeaveUniversityConfirm = $state(false);
  let showLeaveClubConfirm = $state(false);
  let showWeChatBindModal = $state(false);
  let leavingUniversityId = $state('');
  let leavingClubId = $state('');

  // Store WeChat bind result in local state to prevent it from disappearing when URL changes
  let wechatBindResult = $state(data.wechatBindResult);

  const confirmLeaveUniversity = (universityId: string) => {
    leavingUniversityId = universityId;
    showLeaveUniversityConfirm = true;
  };

  const confirmLeaveClub = (clubId: string) => {
    leavingClubId = clubId;
    showLeaveClubConfirm = true;
  };

  // Handle binding a new platform via OAuth
  const handleBindPlatform = async (provider: string) => {
    // Special handling for WeChat - show QR code modal
    if (provider === 'wechat') {
      showWeChatBindModal = true;
      return;
    }

    // For other providers, use OAuth sign-in flow (Auth.js will auto-link when logged in)
    await signIn(provider, {
      redirectTo: page.url.pathname
    });
  };

  // Function to dismiss the WeChat bind alert
  const dismissWechatAlert = () => {
    wechatBindResult = null;
  };

  // Clean up the URL parameter after showing the result (but keep the alert visible)
  $effect(() => {
    if (data.wechatBindResult && page.url.searchParams.has('wechatToken')) {
      // Remove the wechatToken from URL without navigating (keeps history clean)
      const newUrl = new URL(page.url);
      newUrl.searchParams.delete('wechatToken');
      history.replaceState(history.state, '', newUrl.href);
    }
  });
</script>

<svelte:head>
  <title>{pageTitle(m.account_settings())}</title>
</svelte:head>

<div class="space-y-6 md:space-y-10 md:p-5">
  <div>
    <h1 class="text-2xl font-bold md:text-3xl">{m.account_settings()}</h1>
    <p class="text-base-content/70 mt-1">
      {m.manage_account_and_associations()}
    </p>
  </div>

  <!-- Account Information -->
  <div class="bg-base-200 mb-6 rounded-lg">
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
              <p class="text-base-content/60 truncate text-sm">{profile.email}</p>
            {/if}
            <p class="text-base-content/50 text-xs">{getUserTypeLabel(profile.userType)}</p>
          </div>
        </div>

        <!-- Account Details -->
        <div class="space-y-3">
          <div class="ss:flex-row flex flex-col justify-between">
            <span class="text-base-content/70">{m.user_id()}</span>
            <span class="font-mono text-sm">{profile.id}</span>
          </div>
          <div class="ss:flex-row flex flex-col justify-between">
            <span class="text-base-content/70">{m.account_created()}</span>
            <span>{formatDate(profile.joinedAt)}</span>
          </div>
          <div class="ss:flex-row flex flex-col justify-between">
            <span class="text-base-content/70">{m.last_active()}</span>
            <span>{formatDate(profile.lastActiveAt)}</span>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- University Association -->
  <div class="bg-base-200 mb-6 rounded-lg">
    <h2 class="mb-4 text-xl font-semibold">{m.university_associations()}</h2>

    {#if data.universities && data.universities.length > 0}
      <div class="space-y-3">
        {#each data.universities as university (university.id)}
          <div class="bg-base-100 flex items-center justify-between rounded-lg p-4">
            <a
              href={resolve('/(main)/universities/[id]', { id: university.slug || university.id })}
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
                <p class="text-sm opacity-60">
                  {m.joined_on({ date: formatDate(university.joinedAt) })}
                </p>
              </div>
            </a>
            <button
              class="btn btn-soft btn-error btn-sm"
              onclick={() => confirmLeaveUniversity(university.id)}
              aria-label={m.leave_university()}
            >
              <i class="fa-solid fa-sign-out-alt"></i>
              <span class="not-ss:hidden">{m.leave_university()}</span>
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="text-base-content/60 py-8 text-center">
        <i class="fa-solid fa-graduation-cap mb-2 text-2xl"></i>
        <p>{m.not_associated_with_university()}</p>
        <a href={resolve('/(main)/universities')} class="btn btn-primary btn-sm mt-2">
          <i class="fa-solid fa-search"></i>
          {m.find_universities()}
        </a>
      </div>
    {/if}
  </div>

  <!-- Club Memberships -->
  <div class="bg-base-200 mb-6 rounded-lg">
    <h2 class="mb-4 text-xl font-semibold">{m.club_associations()}</h2>

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
                  <a
                    href={resolve('/(main)/clubs/[id]', { id: club.id })}
                    class="hover:text-accent transition-colors"
                  >
                    {club.name}
                  </a>
                </h3>
                {#if club.university}
                  <a
                    href={resolve('/(main)/universities/[id]', {
                      id: club.university.slug || club.university.id
                    })}
                    class="hover:text-accent text-base-content/60 text-sm transition-colors"
                    >{club.university.name}</a
                  >
                {/if}
              </div>
            </div>
            <button
              class="btn btn-soft btn-error btn-sm"
              onclick={() => confirmLeaveClub(club.id)}
              aria-label={m.leave_club()}
            >
              <i class="fa-solid fa-sign-out-alt"></i>
              <span class="not-ss:hidden">{m.leave_club()}</span>
            </button>
          </div>
        {/each}
      </div>
    {:else}
      <div class="text-base-content/60 py-8 text-center">
        <i class="fa-solid fa-users mb-2 text-2xl"></i>
        <p>{m.not_member_of_any_clubs()}</p>
        <a href={resolve('/(main)/clubs')} class="btn btn-primary btn-sm mt-2">
          <i class="fa-solid fa-search"></i>
          {m.find_clubs()}
        </a>
      </div>
    {/if}
  </div>

  <!-- Linked Accounts -->
  <div class="bg-base-200 mb-6 rounded-lg">
    <h2 class="text-xl font-semibold">{m.linked_accounts()}</h2>
    <p class="text-base-content/70 mb-4 text-sm">{m.linked_accounts_description()}</p>

    <!-- WeChat Bind Result Alert -->
    {#if wechatBindResult}
      <div class="alert mb-4 {wechatBindResult.success ? 'alert-success' : 'alert-error'}">
        <i
          class="fa-solid {wechatBindResult.success
            ? 'fa-check-circle'
            : 'fa-exclamation-triangle'}"
        ></i>
        <span>
          {#if wechatBindResult.message === 'wechat_bound_successfully'}
            {m.wechat_bound_successfully()}
          {:else if wechatBindResult.message === 'wechat_already_bound'}
            {m.wechat_already_bound()}
          {:else if wechatBindResult.message === 'wechat_token_invalid_or_expired'}
            {m.wechat_token_invalid_or_expired()}
          {:else}
            {m.wechat_bind_error()}
          {/if}
        </span>
        <button class="btn btn-ghost btn-sm btn-circle" onclick={dismissWechatAlert}>
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    {/if}

    <!-- Email Update Notice for QQ Users -->
    {#if data.needsEmailUpdate}
      <div class="alert alert-warning mb-4">
        <i class="fa-solid fa-exclamation-triangle"></i>
        <span>{m.email_update_required_for_binding()}</span>
      </div>
    {/if}

    <!-- Currently Bound Accounts -->
    {#if data.boundProviders && data.boundProviders.length > 0}
      <div class="space-y-1">
        <h3 class="text-base-content/70 text-sm font-medium">{m.bound_platforms()}</h3>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each getProviders(true).filter( (p) => data.boundProviders.includes(p.id) ) as provider (provider)}
            <div class="bg-base-100 flex items-center gap-3 rounded-lg p-3">
              <div class="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20">
                {#if provider.icon.startsWith('fa-')}
                  <i class="fa-brands fa-lg {provider.icon}"></i>
                {:else}
                  <img
                    src="{base}/{provider.icon}"
                    alt="{provider.name} {m.provider_logo()}"
                    class="h-7 w-7 rounded-full"
                  />
                {/if}
              </div>
              <div class="flex-1">
                <span class="font-medium">{provider.name}</span>
                <p class="text-success text-xs">{m.bound()}</p>
              </div>
              <i class="fa-solid fa-check text-success"></i>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Available Providers to Bind -->
    {#if (data.availableProviders && data.availableProviders.length > 0) || data.canBindWechat}
      <div class="mt-4 space-y-1">
        <h3 class="text-base-content/70 text-sm font-medium">{m.available_to_bind()}</h3>
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each getProviders(true).filter((p) => data.availableProviders.includes(p.id) || (data.canBindWechat && p.id === 'wechat')) || [] as provider (provider)}
            <button
              class="bg-base-100 group flex cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors {provider.class}"
              onclick={() => handleBindPlatform(provider.id)}
            >
              <div
                class="not-group-hover:bg-base-300 flex h-10 w-10 items-center justify-center rounded-full transition-colors"
              >
                {#if provider.icon.startsWith('fa-')}
                  <i class="fa-brands fa-lg {provider.icon}"></i>
                {:else}
                  <img
                    src="{base}/{provider.icon}"
                    alt="{provider.name} {m.provider_logo()}"
                    class="h-7 w-7 rounded-full"
                  />
                {/if}
              </div>
              <div class="flex-1 text-left">
                <span class="font-medium">{provider.name}</span>
                <p class="text-xs text-current/60">{m.click_to_bind()}</p>
              </div>
              <i class="fa-solid fa-plus text-primary mix-blend-difference"></i>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <!-- No accounts message -->
    {#if (!data.boundProviders || data.boundProviders.length === 0) && (!data.availableProviders || data.availableProviders.length === 0) && !data.canBindWechat}
      <div class="text-base-content/60 py-8 text-center">
        <i class="fa-solid fa-link mb-2 text-2xl"></i>
        <p>{m.no_linked_accounts()}</p>
      </div>
    {/if}
  </div>

  <!-- Danger Zone -->
  <div class="bg-error/10 border-error/20 rounded-lg border p-4 sm:p-6">
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
              await signOut({ redirectTo: resolve('/') });
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

<!-- WeChat Bind Modal -->
<div class="modal" class:modal-open={showWeChatBindModal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.bind_wechat()}</h3>
    <div class="py-4">
      <p class="text-base-content/70 mb-4">{m.wechat_bind_instructions()}</p>

      <!-- QR Code Placeholder -->
      <img
        src="{base}/wechat-official-account.jpg"
        alt={m.wechat_official_account_qr_code()}
        class="mx-auto h-48 w-48 rounded-lg"
      />

      <div class="mt-4 space-y-2 text-sm">
        <p class="flex items-start gap-2">
          <span
            class="bg-base-300 text-base-content flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs"
            >1</span
          >
          <span>{m.wechat_bind_step_1()}</span>
        </p>
        <p class="flex items-start gap-2">
          <span
            class="bg-base-300 text-base-content flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs"
            >2</span
          >
          <span>{m.wechat_bind_step_2()}</span>
        </p>
        <p class="flex items-start gap-2">
          <span
            class="bg-base-300 text-base-content flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs"
            >3</span
          >
          <span>{m.wechat_bind_step_3()}</span>
        </p>
      </div>
    </div>
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={() => (showWeChatBindModal = false)}>
        {m.close()}
      </button>
    </div>
  </div>
</div>
