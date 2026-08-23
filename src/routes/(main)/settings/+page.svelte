<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { base } from '$app/paths';
  import type { SocialPlatform } from '$lib/constants';
  import { socialPlatformMessageKey } from '$lib/constants';
  import { m } from '$lib/paraglide/messages';
  import { getDisplayName, getProfileUrl, getProviders } from '$lib/utils';
  import { authClient } from '$lib/auth/client';
  import { toast } from '$lib/notifications/toast.svelte';
  import { resolveStatusMessage } from '$lib/notifications/messages';
  import { showBanner, dismissBanner } from '$lib/notifications/banner.svelte';
  import { unsavedChanges, markUnsavedChanges } from '$lib/actions/unsaved-changes';
  import type { PageData, ActionData } from './$types';
  import UploadModal from '$lib/components/UploadModal.svelte';
  import VerifiedCheckMark from '$lib/components/VerifiedCheckMark.svelte';
  import ProviderIcon from '$lib/components/ProviderIcon.svelte';
  import ProviderCard from '$lib/components/ProviderCard.svelte';

  interface SocialLinkItem {
    platform: SocialPlatform;
    username: string;
    verified?: boolean;
    userId?: string;
  }

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let isSubmitting = $state(false);
  let isAvatarUploadOpen = $state(false);

  // Form data with error handling
  let displayName = $derived(data.userProfile?.displayName || '');
  let bio = $derived(data.userProfile?.bio || '');
  let username = $derived(data.userProfile?.name || '');
  let isEmailPublic = $derived(data.userProfile?.isEmailPublic || false);
  let isActivityPublic = $derived(data.userProfile?.isActivityPublic !== false);
  let isFootprintPublic = $derived(data.userProfile?.isFootprintPublic || false);
  let isUniversityPublic = $derived(data.userProfile?.isUniversityPublic !== false);
  let isFrequentingArcadePublic = $derived(data.userProfile?.isFrequentingArcadePublic !== false);
  let isStarredArcadePublic = $derived(data.userProfile?.isStarredArcadePublic !== false);

  const platforms = getProviders({ profile: true });

  // Social links (writable derived: edits override the server value, and the
  // override is dropped whenever fresh data arrives, e.g. after saving)
  const getServerSocialLinks = () =>
    (data.userProfile?.socialLinks || []).map((link) => ({ ...link }));
  let socialLinks = $derived(getServerSocialLinks());

  // Notification settings
  let notificationTypeComments = $derived(
    data.userProfile?.notificationTypes
      ? data.userProfile.notificationTypes.includes('COMMENTS')
      : true
  );
  let notificationTypeReplies = $derived(
    data.userProfile?.notificationTypes
      ? data.userProfile.notificationTypes.includes('REPLIES')
      : true
  );
  let notificationTypePostVotes = $derived(
    data.userProfile?.notificationTypes
      ? data.userProfile.notificationTypes.includes('POST_VOTES')
      : true
  );
  let notificationTypeCommentVotes = $derived(
    data.userProfile?.notificationTypes
      ? data.userProfile.notificationTypes.includes('COMMENT_VOTES')
      : true
  );
  let notificationTypeJoinRequests = $derived(
    data.userProfile?.notificationTypes
      ? data.userProfile.notificationTypes.includes('JOIN_REQUESTS')
      : true
  );

  // Reset form data when form errors occur (preserve user input)
  $effect(() => {
    if (form && 'formData' in form && form.formData) {
      const formData = form.formData as {
        displayName?: string;
        bio?: string;
        username?: string;
        isEmailPublic?: boolean;
        isActivityPublic?: boolean;
        isFootprintPublic?: boolean;
        isUniversityPublic?: boolean;
        isFrequentingArcadePublic?: boolean;
        isStarredArcadePublic?: boolean;
        notificationTypes?: string[];
      };
      displayName = formData.displayName || '';
      bio = formData.bio || '';
      username = formData.username || '';
      isEmailPublic = formData.isEmailPublic || false;
      isActivityPublic = formData.isActivityPublic !== false;
      isFootprintPublic = formData.isFootprintPublic !== false;
      isUniversityPublic = formData.isUniversityPublic !== false;
      isFrequentingArcadePublic = formData.isFrequentingArcadePublic || false;
      isStarredArcadePublic = formData.isStarredArcadePublic || false;

      const notificationTypes = formData.notificationTypes || [];
      notificationTypeComments = notificationTypes.includes('COMMENTS');
      notificationTypeReplies = notificationTypes.includes('REPLIES');
      notificationTypePostVotes = notificationTypes.includes('POST_VOTES');
      notificationTypeCommentVotes = notificationTypes.includes('COMMENT_VOTES');
      notificationTypeJoinRequests = notificationTypes.includes('JOIN_REQUESTS');

      // Update social links from response
      socialLinks = (formData as { socialLinks?: typeof socialLinks }).socialLinks || [];
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

  // Social links helper functions
  // Social links are stored in state and submitted via hidden inputs, so their
  // mutations don't fire DOM input/change events — mark the form dirty manually.
  const markProfileDirty = () => markUnsavedChanges(formEl, { id: 'settings-profile-unsaved' });

  const removeSocialLink = (index: number) => {
    socialLinks = socialLinks.filter((_: unknown, i: number) => i !== index);
    markProfileDirty();
  };

  // --- Social links modal (add / edit) ---

  let socialModalOpen = $state(false);
  let socialModalStep = $state<'platform' | 'details'>('platform');
  let socialModalPlatform = $state<SocialPlatform>('qq');
  let socialModalEditingIndex = $state<number | null>(null);
  let socialModalUsername = $state('');
  let socialModalError = $state('');

  const openAddSocialModal = () => {
    socialModalEditingIndex = null;
    socialModalPlatform = 'qq';
    socialModalStep = 'platform';
    socialModalUsername = '';
    socialModalError = '';
    socialModalOpen = true;
  };

  const openEditSocialModal = (index: number) => {
    const link = socialLinks[index];
    socialModalEditingIndex = index;
    socialModalPlatform = link.platform;
    socialModalStep = 'details';
    socialModalUsername = link.username;
    socialModalError = '';
    socialModalOpen = true;
  };

  const closeSocialModal = () => {
    socialModalOpen = false;
  };

  const pickSocialPlatform = (platform: SocialPlatform) => {
    socialModalPlatform = platform;
    socialModalUsername = '';
    socialModalError = '';
    socialModalStep = 'details';
  };

  // The bound social link for a platform, if any (used to make bound platforms
  // in the picker open the edit modal instead of being disabled)
  const getBoundLink = (platform: SocialPlatform): SocialLinkItem | undefined =>
    socialLinks.find((link) => link.platform === platform);

  const confirmManualSocialLink = () => {
    const username = socialModalUsername.trim();
    if (!username) {
      socialModalError = m.social_modal_username_required();
      return;
    }
    if (socialModalEditingIndex === null) {
      if (socialLinks.length >= 8) return;
      socialLinks = [...socialLinks, { platform: socialModalPlatform, username }];
    } else {
      socialLinks = socialLinks.map((link, index) =>
        index === socialModalEditingIndex
          ? { ...link, platform: socialModalPlatform, username }
          : link
      );
    }
    markProfileDirty();
    closeSocialModal();
  };

  // The username in the modal still matches a saved verified link
  const editingLinkIsVerified = $derived(
    socialModalEditingIndex !== null &&
      (data.userProfile?.socialLinks || []).some(
        (savedLink) =>
          savedLink.platform === socialModalPlatform &&
          savedLink.username === socialModalUsername &&
          savedLink.verified
      )
  );

  const editingVerifiedHref = $derived(
    getProfileUrl(socialModalPlatform, {
      username: socialModalUsername,
      userId: (data.userProfile?.socialLinks || []).find(
        (savedLink) =>
          savedLink.platform === socialModalPlatform &&
          savedLink.username === socialModalUsername
      )?.userId
    }) ?? ''
  );

  // --- Social link verification ---

  const isVerifiablePlatform = (platform: string): boolean =>
    !!platforms.find((p) => p.id === platform && p.bind);

  // A link is only shown as verified while its value still matches the verified
  // value persisted on the server; touching the input hides the badge immediately.
  const isLinkVerified = (link: SocialLinkItem): boolean => {
    if (!link.verified) return false;
    const saved = (data.userProfile?.socialLinks || []).find(
      (savedLink) => savedLink.platform === link.platform && savedLink.username === link.username
    );
    return !!saved?.verified;
  };

  let pendingVerify: SocialPlatform | null = $state(null);
  let formEl: HTMLFormElement | undefined = $state();

  const verifyFromModal = () => {
    if (socialModalPlatform === 'qq') {
      openQQVerifyModal();
      return;
    }
    // Save any pending edits first, then start the OAuth link flow
    pendingVerify = socialModalPlatform;
    formEl?.requestSubmit();
  };

  // OAuth verification result (landing back from oauth2.link)
  let verifyResultLocal = $state<PageData['verifyResult']>(null);
  let verifyResultDismissed = $state(false);
  $effect(() => {
    if (data.verifyResult) verifyResultLocal = data.verifyResult;
  });

  // Persistent, dismissible banner for the social-link verification result
  $effect(() => {
    if (verifyResultLocal && !verifyResultDismissed) {
      const message = verifyResultLocal.success
        ? m.social_verify_oauth_success({
            platform:
              m[
                `social_platform_${socialPlatformMessageKey(verifyResultLocal.platform as SocialPlatform)}`
              ](),
            username: verifyResultLocal.username || ''
          })
        : verifyResultLocal.error === 'no_account'
          ? m.social_verify_oauth_no_account()
          : m.social_verify_oauth_error();
      showBanner({
        id: 'social-verify-result',
        message,
        type: verifyResultLocal.success ? 'success' : 'error',
        icon: verifyResultLocal.success ? 'fa-circle-check' : 'fa-triangle-exclamation',
        onDismiss: () => (verifyResultDismissed = true)
      });
    }
    return () => dismissBanner('social-verify-result');
  });

  // Strip the verify/verifyError query params from the URL once handled
  $effect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('verify') || url.searchParams.has('verifyError')) {
      url.searchParams.delete('verify');
      url.searchParams.delete('verifyError');
      history.replaceState(history.state, '', url.href);
    }
  });

  // Deep-link straight into a social link flow via ?social=<platform> (used by
  // the kiosk QR code). Bound platforms open the edit modal (same as clicking
  // its edit button); unbound QQ opens the qbind verification modal directly.
  $effect(() => {
    const url = new URL(window.location.href);
    const social = url.searchParams.get('social');
    if (!social) return;
    url.searchParams.delete('social');
    history.replaceState(history.state, '', url.href);

    const platform = social as SocialPlatform;
    const index = socialLinks.findIndex((link) => link.platform === platform);
    if (index !== -1) {
      openEditSocialModal(index);
    } else if (platform === 'qq') {
      openQQVerifyModal();
    } else {
      socialModalPlatform = platform;
      socialModalStep = 'details';
      socialModalUsername = '';
      socialModalError = '';
      socialModalOpen = true;
    }
  });

  // --- QQ verification via qbind ---

  let showQQVerifyModal = $state(false);
  let qqToken = $state('');
  let qqVerified: number | null = $state(null);
  let qqExpired = $state(false);
  let qqError = $state(false);
  let copied = $state(false);
  let copiedTimeout: ReturnType<typeof setTimeout> | undefined = $state();

  const openQQVerifyModal = async () => {
    qqVerified = null;
    qqExpired = false;
    qqError = false;
    try {
      const response = await fetch('/api/qbind/token', { method: 'POST' });
      if (!response.ok) throw new Error('failed_to_issue_token');
      const { token } = (await response.json()) as { token: string };
      qqToken = token;
    } catch {
      qqToken = '';
      qqError = true;
    }
    showQQVerifyModal = true;
  };

  const copyQQCommand = async () => {
    try {
      await navigator.clipboard.writeText(`/qbind ${qqToken}`);
      copied = true;
      clearTimeout(copiedTimeout);
      copiedTimeout = setTimeout(() => {
        copied = false;
        copiedTimeout = undefined;
      }, 1000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  $effect(() => {
    if (!showQQVerifyModal) return;
    const deadline = Date.now() + 600_000;
    const timer = setInterval(async () => {
      if (Date.now() > deadline) {
        qqExpired = true;
        clearInterval(timer);
        return;
      }
      try {
        const response = await fetch(`/api/qbind?token=${encodeURIComponent(qqToken)}`);
        if (response.ok) {
          const result = (await response.json()) as { success: boolean; qq: number };
          qqVerified = result.qq;
          clearInterval(timer);
        } else if (response.status !== 404) {
          qqError = true;
          clearInterval(timer);
        }
      } catch {
        // transient network error — keep polling
      }
    }, 5000);
    return () => clearInterval(timer);
  });

  const finishQQVerify = () => {
    showQQVerifyModal = false;
    socialModalOpen = false;
    invalidateAll();
  };
</script>

<div class="space-y-6 md:space-y-10 md:p-5">
  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold md:text-3xl">{m.personal_settings()}</h1>
    <p class="text-base-content/70 mt-1">
      {m.manage_your_personal_information_and_preferences()}
    </p>
  </div>

  <!-- User Avatar & Basic Info -->
  {#if data.userProfile}
    <div class="bg-base-100 rounded-lg p-6">
      <div class="xs:flex-row xs:gap-6 flex flex-col items-center gap-4">
        <div class="relative">
          <div class="avatar">
            <div class="h-20 w-20 rounded-full">
              {#if data.userProfile.image}
                <img src={data.userProfile.image} alt={m.profile_image()} />
              {:else}
                <div
                  class="bg-neutral text-neutral-content flex h-full w-full items-center justify-center text-2xl font-bold"
                >
                  {(data.userProfile.displayName ?? data.userProfile.name)
                    ?.charAt(0)
                    ?.toUpperCase() || '?'}
                </div>
              {/if}
            </div>
          </div>
          <button
            type="button"
            class="btn btn-circle btn-soft btn-sm border-base-100 absolute right-0 bottom-0 border-2"
            onclick={() => (isAvatarUploadOpen = true)}
            aria-label={m.change_avatar()}
          >
            <i class="fa-solid fa-camera text-xs"></i>
          </button>
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

    <UploadModal
      bind:isOpen={isAvatarUploadOpen}
      uploadUrl="/api/users/avatar"
      title={m.upload_avatar()}
      confirmLabel={m.upload_avatar()}
      onSuccess={() => invalidateAll()}
    />
  {/if}

  <!-- Profile Form -->
  <form
    method="POST"
    action="?/updateProfile"
    bind:this={formEl}
    use:enhance={() => {
      isSubmitting = true;

      return async ({ result, update }) => {
        isSubmitting = false;

        if (result.type === 'success' && result.data?.success) {
          toast(m.profile_updated(), { type: 'success' });
          invalidateAll();
          if (formEl) formEl.dataset.dirty = '0';
          dismissBanner('settings-profile-unsaved');

          const platform = pendingVerify;
          if (platform) {
            pendingVerify = null;
            await authClient.oauth2.link({
              providerId: platform,
              callbackURL: `${base}/settings?verify=${platform}`,
              errorCallbackURL: `${base}/settings?verify=${platform}&verifyError=1`
            });
          }
        } else if (result.type === 'failure') {
          const message = resolveStatusMessage(
            (result.data as { message?: string } | undefined)?.message
          );
          if (message) toast(message, { type: 'error' });
          await update();
        }
      };
    }}
    use:unsavedChanges={{ id: 'settings-profile-unsaved' }}
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
        class="textarea textarea-bordered h-24 w-full rounded-xl"
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

    <!-- Social Links -->
    <div class="form-control">
      <div class="mb-3 flex items-center justify-between gap-2">
        <div class="form-control">
          <label class="label" for="social-links-section">
            <span class="label-text">{m.social_links()}</span>
          </label>
          <p class="text-base-content/70 text-sm">{m.social_links_description()}</p>
        </div>
        {#if socialLinks.length < 8}
          <button
            type="button"
            class="btn btn-soft btn-success btn-sm"
            onclick={openAddSocialModal}
          >
            <i class="fa-solid fa-plus"></i>
            {m.add()}
          </button>
        {/if}
      </div>

      {#if socialLinks.length === 0}
        <div class="text-base-content/60 py-8 text-center">
          <i class="fa-solid fa-link mb-2 text-2xl"></i>
          <p>{m.social_links_empty()}</p>
        </div>
      {:else}
        <div id="social-links-section" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {#each socialLinks as link, index (index)}
            {@const provider = platforms.find((p) => p.id === link.platform)}
            {@const platformName = m[
              `social_platform_${socialPlatformMessageKey(link.platform)}`
            ]()}
            {@const profileHref = getProfileUrl(link.platform, link)}
            {@const verifiedHref = isLinkVerified(link) ? (profileHref ?? '') : ''}
            <div class="bg-base-200 flex items-center gap-3 rounded-lg p-3">
              <div
                class="bg-base-100 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              >
                <ProviderIcon
                  icon={provider?.icon}
                  name={provider?.name ?? link.platform}
                  class="text-base-content/70"
                  imgClass="h-6 w-6 rounded-full"
                />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-base-content/60 truncate text-xs">{platformName}</p>
                <div class="flex items-center gap-1.5">
                  <span class="font-medium break-all">{link.username}</span>
                  {#if isLinkVerified(link)}
                    <VerifiedCheckMark href={verifiedHref} />
                  {/if}
                </div>
              </div>
              <div class="flex items-center">
                {#if profileHref}
                  <a
                    class="btn btn-circle btn-ghost btn-sm"
                    href={profileHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={m.social_open_profile({ platform: platformName })}
                    aria-label={m.social_open_profile({ platform: platformName })}
                  >
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                  </a>
                {/if}
                <button
                  type="button"
                  class="btn btn-circle btn-ghost btn-sm"
                  onclick={() => openEditSocialModal(index)}
                  title={m.edit()}
                  aria-label={m.edit()}
                >
                  <i class="fa-solid fa-pen"></i>
                </button>
                <button
                  type="button"
                  class="btn btn-circle btn-ghost btn-error btn-sm"
                  onclick={() => removeSocialLink(index)}
                  title={m.delete()}
                  aria-label={m.delete()}
                >
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Draft social links are submitted as a single JSON payload -->
      <input
        type="hidden"
        name="socialLinks"
        value={JSON.stringify($state.snapshot(socialLinks))}
      />
    </div>

    <div class="divider">{m.notification_settings()}</div>

    <div class="space-y-3">
      <!-- Notification Types -->
      <div class="form-control">
        <!-- svelte-ignore a11y_label_has_associated_control -->
        <label class="label">
          <span class="label-text">{m.notification_types()}</span>
        </label>
        <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              name="notificationTypeComments"
              class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
              bind:checked={notificationTypeComments}
            />
            <div>
              <span class="text-base-content text-wrap">{m.notification_comments()}</span>
              <div class="text-base-content/60 text-xs text-wrap">
                {m.notification_comments_desc()}
              </div>
            </div>
          </label>

          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              name="notificationTypeReplies"
              class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
              bind:checked={notificationTypeReplies}
            />
            <div>
              <span class="text-base-content text-wrap">{m.notification_replies()}</span>
              <div class="text-base-content/60 text-xs text-wrap">
                {m.notification_replies_desc()}
              </div>
            </div>
          </label>

          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              name="notificationTypePostVotes"
              class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
              bind:checked={notificationTypePostVotes}
            />
            <div>
              <span class="text-base-content text-wrap">{m.notification_post_votes()}</span>
              <div class="text-base-content/60 text-xs text-wrap">
                {m.notification_post_votes_desc()}
              </div>
            </div>
          </label>

          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              name="notificationTypeCommentVotes"
              class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
              bind:checked={notificationTypeCommentVotes}
            />
            <div>
              <span class="text-base-content text-wrap">{m.notification_comment_votes()}</span>
              <div class="text-base-content/60 text-xs text-wrap">
                {m.notification_comment_votes_desc()}
              </div>
            </div>
          </label>

          <label class="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              name="notificationTypeJoinRequests"
              class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
              bind:checked={notificationTypeJoinRequests}
            />
            <div>
              <span class="text-base-content text-wrap">{m.notification_join_requests()}</span>
              <div class="text-base-content/60 text-xs text-wrap">
                {m.notification_join_requests_desc()}
              </div>
            </div>
          </label>
        </div>
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
            <span class="text-base-content text-wrap">{m.email_visibility()}</span>
            <div class="text-base-content/60 text-xs text-wrap">{m.email_public()}</div>
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
            <span class="text-base-content text-wrap">{m.university_visibility()}</span>
            <div class="text-base-content/60 text-xs text-wrap">{m.university_public()}</div>
          </div>
        </label>
      </div>

      <!-- Activity Visibility -->
      <div class="form-control">
        <label class="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            name="isActivityPublic"
            class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
            bind:checked={isActivityPublic}
          />
          <div>
            <span class="text-base-content text-wrap">{m.activity_visibility()}</span>
            <div class="text-base-content/60 text-xs text-wrap">{m.activity_public()}</div>
          </div>
        </label>
      </div>

      <!-- Footprint Visibility -->
      <div class="form-control">
        <label class="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            name="isFootprintPublic"
            class="checkbox hover:checkbox-primary checked:checkbox-primary transition"
            bind:checked={isFootprintPublic}
          />
          <div>
            <span class="text-base-content text-wrap">{m.footprint_visibility()}</span>
            <div class="text-base-content/60 text-xs text-wrap">{m.footprint_public()}</div>
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
            <span class="text-base-content text-wrap">{m.frequenting_arcades_visibility()}</span>
            <div class="text-base-content/60 text-xs text-wrap">
              {m.frequenting_arcades_public()}
            </div>
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
            <span class="text-base-content text-wrap">{m.starred_arcades_visibility()}</span>
            <div class="text-base-content/60 text-xs text-wrap">{m.starred_arcades_public()}</div>
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

<!-- QQ Verification Modal (qbind) -->
{#if showQQVerifyModal}
  <div class="modal modal-open z-1000">
    <div class="modal-box">
      <button
        class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2"
        onclick={() => {
          showQQVerifyModal = false;
          invalidateAll();
        }}
        aria-label={m.close()}
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
      <h3 class="flex items-center gap-2 text-lg font-bold">
        <i class="fa-brands fa-qq"></i>
        {m.social_verify_qq_title()}
      </h3>
      <div class="space-y-3 py-4">
        {#if qqVerified}
          <div
            class="bg-success/10 border-success flex flex-col items-center gap-2 rounded-xl border-2 p-4"
          >
            <span>{m.social_verify_qq_success()}</span>
            <div class="flex items-center gap-2">
              <i class="fa-brands fa-qq text-2xl"></i>
              <h4 class="font-medium">{qqVerified}</h4>
            </div>
          </div>
        {:else if qqExpired}
          <div
            class="bg-error/10 border-error flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center"
          >
            <i class="fa-solid fa-clock text-error text-2xl"></i>
            <span>{m.social_verify_qq_expired()}</span>
          </div>
        {:else if qqError}
          <div
            class="bg-error/10 border-error flex flex-col items-center gap-2 rounded-xl border-2 p-4 text-center"
          >
            <i class="fa-solid fa-exclamation-triangle text-error text-2xl"></i>
            <span>{m.social_verify_qq_error()}</span>
          </div>
        {:else}
          {#if data.qbindGroups && data.qbindGroups.length > 0}
            <p>{m.social_verify_qq_instructions()}</p>
            <div
              class="bg-success/10 border-success flex flex-col items-center gap-1 rounded-xl border-2 p-4 text-sm"
            >
              <span class="text-base font-semibold">{m.social_verify_qq_group_label()}</span>
              {#each data.qbindGroups as group, groupIndex (groupIndex)}
                <div>
                  {#if group.name}
                    <span>{group.name}</span>
                  {/if}
                  {#if group.number}
                    <span class="font-mono">({group.number})</span>
                  {/if}
                </div>
              {/each}
            </div>
          {:else}
            <p>{m.social_verify_qq_instructions_no_group()}</p>
          {/if}
          <div class="bg-base-200 flex items-center justify-between gap-2 rounded-xl p-3">
            <code class="text-left break-all">/qbind {qqToken}</code>
            <button
              class="btn btn-success btn-sm btn-square btn-soft"
              class:btn-active={copied}
              title={m.copy()}
              onclick={copyQQCommand}
            >
              {#if copied}
                <i class="fa-solid fa-check"></i>
              {:else}
                <i class="fa-solid fa-copy"></i>
              {/if}
            </button>
          </div>
          <div class="text-base-content/60 flex items-center justify-center gap-2 text-sm">
            <span class="loading loading-spinner loading-sm"></span>
            {m.social_verify_qq_waiting()}
          </div>
        {/if}
      </div>
      <div class="modal-action">
        <button
          class="btn btn-ghost"
          onclick={() => {
            showQQVerifyModal = false;
            invalidateAll();
          }}
        >
          {m.close()}
        </button>
        {#if qqVerified}
          <button class="btn btn-success" onclick={finishQQVerify}>
            <i class="fa-solid fa-check"></i>
            {m.confirm()}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Add / Edit Social Link Modal -->
{#if socialModalOpen}
  <div class="modal modal-open">
    <div class="modal-box">
      <button
        class="btn btn-sm btn-circle btn-ghost absolute top-2 right-2"
        onclick={closeSocialModal}
        aria-label={m.close()}
      >
        <i class="fa-solid fa-xmark"></i>
      </button>
      <h3 class="text-lg font-bold">
        {socialModalStep === 'platform'
          ? m.social_modal_pick_platform()
          : socialModalEditingIndex === null
            ? m.social_modal_add_title()
            : m.social_modal_edit_title()}
      </h3>

      {#if socialModalStep === 'platform'}
        <div class="grid grid-cols-1 gap-2 py-4 sm:grid-cols-2">
          {#each platforms as provider (provider.id)}
            {@const platform = provider.id}
            {@const boundLink = getBoundLink(platform)}
            <ProviderCard
              {provider}
              variant="pick"
              onclick={() => {
                if (boundLink) {
                  const index = socialLinks.findIndex((l) => l.platform === platform);
                  if (index !== -1) openEditSocialModal(index);
                } else {
                  pickSocialPlatform(platform);
                }
              }}
            >
              {#snippet subtitle()}
                {#if boundLink}
                  <span class="text-success block truncate text-xs mix-blend-difference">
                    <i class="fa-solid fa-circle-check mr-1"></i>{boundLink.username}
                  </span>
                {:else if isVerifiablePlatform(platform)}
                  <span class="text-success block text-xs mix-blend-difference">
                    <i class="fa-solid fa-circle-check"></i>
                    {m.social_link_verify()}
                  </span>
                {/if}
              {/snippet}
            </ProviderCard>
          {/each}
        </div>
      {:else}
        <div class="space-y-4 pt-4">
          <div class="flex items-center gap-2">
            {#if socialModalEditingIndex === null}
              <button
                type="button"
                class="btn btn-circle btn-ghost btn-sm"
                onclick={() => (socialModalStep = 'platform')}
                aria-label={m.back()}
              >
                <i class="fa-solid fa-arrow-left"></i>
              </button>
            {/if}
            <ProviderIcon
              icon={platforms.find((p) => p.id === socialModalPlatform)?.icon}
              name={platforms.find((p) => p.id === socialModalPlatform)?.name ??
                socialModalPlatform}
              class="text-xl"
            />
            <span class="font-semibold">
              {m[`social_platform_${socialPlatformMessageKey(socialModalPlatform)}`]()}
            </span>
          </div>

          {#if isVerifiablePlatform(socialModalPlatform)}
            {#if editingLinkIsVerified}
              <div
                class="bg-success/10 border-success flex items-center justify-between gap-2 rounded-xl border-2 p-3"
              >
                <span class="flex min-w-0 items-center gap-2">
                  <span class="font-medium break-all">{socialModalUsername}</span>
                  <VerifiedCheckMark href={editingVerifiedHref} />
                </span>
                <button
                  type="button"
                  class="btn btn-soft btn-success btn-sm"
                  onclick={verifyFromModal}
                >
                  <i class="fa-solid fa-circle-check"></i>
                  {m.social_link_verify()}
                </button>
              </div>
            {:else}
              <button type="button" class="btn btn-primary btn-block" onclick={verifyFromModal}>
                <i class="fa-solid fa-circle-check"></i>
                {m.social_verify_with_platform({
                  platform: m[`social_platform_${socialPlatformMessageKey(socialModalPlatform)}`]()
                })}
              </button>
              <p class="text-base-content/60 text-center text-xs">
                {m.social_modal_verify_hint()}
              </p>
            {/if}
            <div class="divider">{m.or()}</div>
          {/if}

          <div class="form-control">
            <input
              type="text"
              bind:value={socialModalUsername}
              oninput={() => (socialModalError = '')}
              placeholder={m.social_placeholder({
                platform: m[`social_platform_${socialPlatformMessageKey(socialModalPlatform)}`](),
                isNumber: socialModalPlatform === 'qq' ? 'true' : 'false'
              })}
              class="input input-bordered w-full"
              class:input-error={!!socialModalError}
            />
            {#if socialModalError}
              <div class="label">
                <span class="label-text-alt text-error">
                  <i class="fa-solid fa-exclamation-triangle mr-1"></i>
                  {socialModalError}
                </span>
              </div>
            {/if}
          </div>

          <div class="modal-action">
            <button type="button" class="btn btn-ghost" onclick={closeSocialModal}>
              {m.close()}
            </button>
            <button type="button" class="btn btn-success" onclick={confirmManualSocialLink}>
              <i class="fa-solid fa-check"></i>
              {socialModalEditingIndex === null ? m.add() : m.save()}
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}
