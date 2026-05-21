<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/utils';
  import { slide } from 'svelte/transition';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Send OTP form state
  let countryCode = $state('');
  let phoneNumber = $state('');
  let isSending = $state(false);

  // Verify OTP form state
  let code = $state('');
  let isVerifying = $state(false);
  let codeSent = $state(false);

  // Removal state
  let isRemoving = $state(false);

  // Messages
  let errorMessage = $state('');
  let successMessage = $state('');

  // 60-second frontend cooldown
  let cooldownSeconds = $state(0);
  let cooldownInterval: ReturnType<typeof setInterval> | null = null;

  // Turnstile
  let turnstileToken = $state('');
  let turnstileWidgetId = $state<string | null>(null);
  let turnstileContainer = $state<HTMLDivElement | null>(null);

  type TurnstileWindow = typeof window & {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback': () => void;
          'error-callback': () => void;
          size: string;
        }
      ) => string;
      reset: (id: string) => void;
    };
    onloadTurnstileCallback?: () => void;
  };

  $effect(() => {
    if (!data.turnstileSiteKey || !turnstileContainer) return;
    const w = window as TurnstileWindow;
    const sitekey = data.turnstileSiteKey;
    const container = turnstileContainer;

    const doRender = () => {
      if (turnstileWidgetId !== null || !w.turnstile) return;
      turnstileWidgetId = w.turnstile.render(container, {
        sitekey,
        callback: (token: string) => {
          turnstileToken = token;
        },
        'expired-callback': () => {
          turnstileToken = '';
        },
        'error-callback': () => {
          turnstileToken = '';
        },
        size: 'normal'
      });
    };

    if (w.turnstile) {
      doRender();
    } else {
      const prev = w.onloadTurnstileCallback;
      w.onloadTurnstileCallback = () => {
        if (prev) prev();
        doRender();
      };
      if (!document.querySelector('script[data-turnstile]')) {
        const script = document.createElement('script');
        script.src =
          'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onloadTurnstileCallback&render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.turnstile = '1';
        document.head.appendChild(script);
      }
    }
  });

  function resetTurnstile() {
    const w = window as TurnstileWindow;
    if (w.turnstile && turnstileWidgetId !== null) {
      w.turnstile.reset(turnstileWidgetId);
    }
    turnstileToken = '';
  }

  function startCooldown(seconds: number) {
    cooldownSeconds = seconds;
    if (cooldownInterval) clearInterval(cooldownInterval);
    cooldownInterval = setInterval(() => {
      cooldownSeconds -= 1;
      if (cooldownSeconds <= 0) {
        cooldownSeconds = 0;
        if (cooldownInterval) {
          clearInterval(cooldownInterval);
          cooldownInterval = null;
        }
      }
    }, 1000);
  }

  const handleSendCode = async () => {
    const trimmedPhone = phoneNumber.trim();
    const trimmedCountry = countryCode.trim();

    if (!trimmedPhone || !trimmedCountry) {
      errorMessage = m.validation_error();
      return;
    }

    // Client-side uniqueness check: same as current bound number
    if (data.phone === trimmedPhone && data.phoneCountryCode === trimmedCountry) {
      errorMessage = m.phone_settings_already_yours();
      return;
    }

    if (data.turnstileSiteKey && !turnstileToken) {
      errorMessage = m.phone_settings_turnstile_failed();
      return;
    }

    isSending = true;
    errorMessage = '';
    successMessage = '';

    try {
      const res = await fetch('/api/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: trimmedPhone,
          countryCode: trimmedCountry,
          ...(data.turnstileSiteKey ? { turnstileToken } : {})
        })
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'phone_already_yours') {
          errorMessage = m.phone_settings_already_yours();
        } else {
          errorMessage = m.phone_settings_taken();
        }
        resetTurnstile();
        return;
      }

      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'cooldown') {
          startCooldown(body.retryAfter ?? 60);
          errorMessage = m.phone_settings_cooldown({ seconds: body.retryAfter ?? 60 });
        } else {
          errorMessage = m.phone_settings_daily_limit();
        }
        resetTurnstile();
        return;
      }

      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'turnstile_failed' || body.error === 'turnstile_missing') {
          errorMessage = m.phone_settings_turnstile_failed();
          resetTurnstile();
          return;
        }
      }

      if (!res.ok) {
        errorMessage = m.phone_settings_error();
        resetTurnstile();
        return;
      }

      codeSent = true;
      startCooldown(60);
      successMessage = '';
    } catch {
      errorMessage = m.phone_settings_error();
      resetTurnstile();
    } finally {
      isSending = false;
    }
  };

  const handleVerify = async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      errorMessage = m.validation_error();
      return;
    }

    isVerifying = true;
    errorMessage = '';
    successMessage = '';

    try {
      const res = await fetch('/api/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneNumber.trim(),
          countryCode: countryCode.trim(),
          code: trimmedCode
        })
      });

      if (!res.ok) {
        errorMessage = m.phone_settings_error_invalid();
        return;
      }

      const body = await res.json();
      if (!body.verified) {
        errorMessage = m.phone_settings_error_invalid();
        return;
      }

      code = '';
      codeSent = false;
      successMessage = m.phone_settings_verify_success();
      await invalidateAll();
    } catch {
      errorMessage = m.phone_settings_error_invalid();
    } finally {
      isVerifying = false;
    }
  };

  const handleRemove = async () => {
    if (!confirm(m.phone_settings_remove_confirm())) return;

    isRemoving = true;
    errorMessage = '';
    successMessage = '';

    try {
      const res = await fetch('/api/phone', { method: 'DELETE' });

      if (!res.ok) {
        errorMessage = m.phone_settings_error();
        return;
      }

      successMessage = m.phone_settings_unbind_success();
      codeSent = false;
      phoneNumber = '';
      countryCode = '';
      code = '';
      await invalidateAll();
    } catch {
      errorMessage = m.phone_settings_error();
    } finally {
      isRemoving = false;
    }
  };
</script>

<svelte:head>
  <title>{pageTitle(m.phone_settings())}</title>
</svelte:head>

<div class="space-y-6 md:space-y-8 md:p-5">
  <div class="space-y-2">
    <h1 class="text-2xl font-bold md:text-3xl">{m.phone_settings()}</h1>
    <p class="text-base-content/70 text-sm md:text-base">
      {m.phone_settings_description()}
    </p>
  </div>

  {#if successMessage}
    <div class="alert alert-success">
      <i class="fa-solid fa-check-circle"></i>
      <span>{successMessage}</span>
    </div>
  {/if}

  {#if errorMessage}
    <div class="alert alert-error">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>{errorMessage}</span>
    </div>
  {/if}

  <!-- Current phone number -->
  <section
    class="bg-base-100 grid gap-4 rounded-2xl border border-current/10 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:p-6"
  >
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-lg font-semibold">{m.phone_settings_current()}</h2>
      </div>

      {#if data.phone}
        <p class="text-base font-medium">
          <span class="text-current/70">+{data.phoneCountryCode}</span>
          {data.phone}
        </p>
      {:else}
        <p class="text-base-content/70">{m.phone_settings_none()}</p>
      {/if}
    </div>

    {#if data.phone}
      <button
        type="button"
        class="btn btn-soft btn-error btn-sm"
        onclick={handleRemove}
        disabled={isRemoving}
      >
        {#if isRemoving}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        {m.phone_settings_remove()}
      </button>
    {/if}
  </section>

  <!-- Bind / update phone -->
  <section class="bg-base-100 rounded-2xl border border-current/10 p-5 md:p-6">
    <div class="mb-4 space-y-2">
      <h2 class="text-lg font-semibold">
        {data.phone ? m.phone_settings_change() : m.phone_settings_bind()}
      </h2>
    </div>

    <div>
      <!-- Country code + phone number row -->
      <div class="mb-4 flex gap-2">
        <label class="form-control max-w-1/4 shrink-0 gap-2">
          <span class="label-text sr-only">{m.phone_settings_country_code_placeholder()}</span>
          <select
            class="select select-bordered"
            bind:value={countryCode}
            autocomplete="tel-country-code"
          >
            <option value="" disabled>{m.phone_settings_country_code_placeholder()}</option>
            {#each data.countries as country (country.isoCode)}
              <option value={country.dialCode}>+{country.dialCode} {country.name}</option>
            {/each}
          </select>
        </label>

        <label class="form-control flex-1 gap-2">
          <span class="label-text sr-only">{m.phone_settings_phone_placeholder()}</span>
          <input
            class="input input-bordered w-full"
            type="tel"
            bind:value={phoneNumber}
            placeholder={m.phone_settings_phone_placeholder()}
            autocomplete="tel-national"
          />
        </label>

        <button
          type="button"
          class="btn btn-primary btn-soft not-sm:btn-circle"
          onclick={handleSendCode}
          disabled={isSending || cooldownSeconds > 0}
        >
          {#if isSending}
            <span class="loading loading-spinner"></span>
          {:else if !(cooldownSeconds > 0)}
            <i class="fa-solid fa-paper-plane"></i>
          {/if}
          {#if cooldownSeconds > 0}
            {cooldownSeconds}s
          {:else}
            <span class="not-sm:hidden">{m.phone_settings_send_code()}</span>
          {/if}
        </button>
      </div>

      {#if data.turnstileSiteKey && !codeSent}
        <div class="mb-4" bind:this={turnstileContainer} transition:slide></div>
      {/if}

      {#if codeSent}
        <div class="flex gap-2" transition:slide>
          <input
            class="input input-bordered w-full"
            type="text"
            inputmode="numeric"
            bind:value={code}
            placeholder={m.phone_settings_code_placeholder()}
            autocomplete="one-time-code"
            maxlength={6}
          />

          <button
            type="button"
            class="btn btn-primary"
            onclick={handleVerify}
            disabled={isVerifying}
          >
            {#if isVerifying}
              <span class="loading loading-spinner"></span>
            {/if}
            {m.phone_settings_verify_submit()}
          </button>
        </div>
      {/if}
    </div>
  </section>
</div>
