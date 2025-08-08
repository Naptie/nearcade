<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import { base } from '$app/paths';
  import { getDisplayName, fromPath } from '$lib/utils';

  let { data }: { data: PageData } = $props();

  let isProcessing = $state(false);
  let message = $state('');
  let messageType = $state<'success' | 'error' | ''>('');

  const handleAcceptInvite = async () => {
    isProcessing = true;
    message = '';
    messageType = '';

    try {
      const response = await fetch(fromPath(`/api/invites/${data.invite.code}/redeem`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const result = (await response.json()) as { message?: string };
        message = result.message || m.invite_used_successfully();
        messageType = 'success';

        // Redirect after a delay
        setTimeout(() => {
          goto(
            `${base}/${data.invite.type === 'university' ? 'universities' : 'clubs'}/${data.targetInfo.slug || data.targetInfo.id}`
          );
        }, 2000);
      } else {
        const error = (await response.json()) as { message?: string };
        message = error.message || m.error_occurred();
        messageType = 'error';
      }
    } catch (error) {
      console.error('Error accepting invite:', error);
      message = m.error_occurred();
      messageType = 'error';
    } finally {
      isProcessing = false;
    }
  };

  const getInviteStatusText = () => {
    if (data.invite.expiresAt) {
      const expiryDate = new Date(data.invite.expiresAt);
      if (expiryDate > new Date()) {
        return m.invite_expires({ date: expiryDate.toLocaleDateString() });
      } else {
        return m.expired();
      }
    }
    return '';
  };

  const getUsageText = () => {
    if (data.invite.maxUses) {
      return m.uses({
        current: data.invite.currentUses,
        max: data.invite.maxUses
      });
    }
    return m.unlimited_uses();
  };
</script>

<svelte:head>
  <title>{m.invite_link()} - {m.app_name()}</title>
</svelte:head>

<div class="bg-base-100 flex min-h-screen items-center justify-center p-4">
  <div class="w-full max-w-2xl">
    <!-- Invite Card -->
    <div class="bg-base-200 overflow-hidden rounded-lg shadow-lg">
      <!-- Header -->
      <div class="bg-primary text-primary-content p-6">
        <div class="flex items-center gap-4">
          <div class="bg-primary-content/20 rounded-full p-3">
            <i
              class="fa-solid {data.invite.type === 'university'
                ? 'fa-graduation-cap'
                : 'fa-users-gear'} text-2xl"
            ></i>
          </div>
          <div>
            <h1 class="text-2xl font-bold">
              {data.invite.title || m.invite_title_placeholder({ target: data.targetInfo.name })}
            </h1>
            <p class="text-primary-content/80">
              {data.invite.type === 'university' ? m.university() : m.club()}
              {m.invite()}
            </p>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="p-6">
        <!-- Target Info -->
        <div class="mb-6">
          <a
            href="{base}/{data.invite.type === 'university' ? 'universities' : 'clubs'}/{data
              .targetInfo.slug || data.targetInfo.id}"
            target="_blank"
            class="group mb-4 flex items-center gap-4"
          >
            {#if data.targetInfo.avatarUrl}
              <img
                src={data.targetInfo.avatarUrl}
                alt="{data.targetInfo.name} {m.logo()}"
                class="h-16 w-16 rounded-full bg-white"
              />
            {:else}
              <div class="bg-base-300 flex h-16 w-16 items-center justify-center rounded-full">
                <i
                  class="fa-solid {data.invite.type === 'university'
                    ? 'fa-graduation-cap'
                    : 'fa-users-gear'} text-base-content/50 text-xl"
                ></i>
              </div>
            {/if}
            <div class="group-hover:text-accent transition-colors">
              <h2 class="text-xl font-semibold">{data.targetInfo.name}</h2>
              {#if 'type' in data.targetInfo}
                <p class="opacity-70">{data.targetInfo.type}</p>
              {:else}
                <p class="text-base-content/70">
                  {data.targetInfo.description || m.student_organization()}
                </p>
              {/if}
            </div>
          </a>

          <!-- Description -->
          {#if data.invite.description}
            <div class="bg-base-100 mb-4 rounded-lg p-4">
              <p class="text-base-content/80">{data.invite.description}</p>
            </div>
          {/if}
        </div>

        <!-- Invite Details -->
        <div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div class="bg-base-100 rounded-lg p-4">
            <div class="mb-2 flex items-center gap-2">
              <i class="fa-solid fa-clock text-base-content/50"></i>
              <span class="font-medium">{m.invite_validity()}</span>
            </div>
            <p class="text-base-content/70 text-sm">
              {getInviteStatusText() || m.invite_never_expires()}
            </p>
          </div>

          <div class="bg-base-100 rounded-lg p-4">
            <div class="mb-2 flex items-center gap-2">
              <i class="fa-solid fa-users text-base-content/50"></i>
              <span class="font-medium">{m.invite_usage_limit()}</span>
            </div>
            <p class="text-base-content/70 text-sm">
              {getUsageText()}
            </p>
          </div>
        </div>

        <!-- Settings Info -->
        {#if data.invite.requireApproval}
          <div class="bg-base-100 mb-6 rounded-lg p-4">
            <h3 class="mb-3 font-medium">{m.invite_settings()}</h3>
            <div class="space-y-2">
              {#if data.invite.requireApproval}
                <div class="flex items-center gap-2 text-sm">
                  <i class="fa-solid fa-exclamation-triangle text-warning"></i>
                  <span>{m.invite_requires_approval()}</span>
                </div>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Message Display -->
        {#if message}
          <div class="alert {messageType === 'success' ? 'alert-success' : 'alert-error'} mb-4">
            <i
              class="fa-solid {messageType === 'success'
                ? 'fa-check-circle'
                : 'fa-exclamation-triangle'}"
            ></i>
            {message}
          </div>
        {/if}

        <!-- Current User Info -->
        <div class="bg-base-100 mb-6 rounded-lg p-4">
          <h3 class="mb-3 font-medium">{m.current_user_identity()}</h3>
          <div class="flex items-center gap-3">
            {#if data.user.image}
              <img src={data.user.image} alt={m.user_avatar()} class="h-10 w-10 rounded-full" />
            {:else}
              <div class="bg-base-300 flex h-10 w-10 items-center justify-center rounded-full">
                <i class="fa-solid fa-user text-base-content/50"></i>
              </div>
            {/if}
            <div>
              <p class="font-medium">{getDisplayName(data.user)}</p>
              {#if data.user.email && !data.user.email.endsWith('.nearcade')}
                <p class="text-base-content/70 text-sm">{data.user.email}</p>
              {/if}
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex justify-center gap-3">
          <button class="btn btn-outline" onclick={() => history.back()}> {m.go_back()} </button>
          <button
            class="btn btn-primary"
            onclick={handleAcceptInvite}
            disabled={isProcessing || messageType === 'success'}
          >
            {#if isProcessing}
              <span class="loading loading-spinner loading-sm"></span>
              {m.processing()}
            {:else if messageType === 'success'}
              <i class="fa-solid fa-check"></i>
              {m.accepted()}
            {:else}
              <i class="fa-solid fa-check"></i>
              {m.accept_invitation()}
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>
</div>
