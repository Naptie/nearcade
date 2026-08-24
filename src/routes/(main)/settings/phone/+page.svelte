<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { pageTitle } from '$lib/utils';
  import { toast } from '$lib/notifications/toast.svelte';
  import { slide } from 'svelte/transition';
  import { untrack } from 'svelte';
  import type { PageData } from './$types';

  type PhonePageData = PageData & {
    hcaptchaSiteKey: string | null;
  };

  type Region = PhonePageData['regions'][number];

  let { data }: { data: PhonePageData } = $props();

  // Send OTP form state
  let countryCode = $state(untrack(() => data.regions[0]?.dialCode ?? ''));
  let phoneNumber = $state('');
  let isSending = $state(false);

  // Verify OTP form state
  let code = $state('');
  let isVerifying = $state(false);
  let codeSent = $state(false);

  // Telegram verification state
  let telegramSession = $state<{
    sessionId: string;
    deepLink: string;
    expiresAt: string;
    ttl: number;
  } | null>(null);
  let telegramPollTimer: ReturnType<typeof setInterval> | null = null;
  let telegramExpiresAt = $state(0);
  let telegramPhone = $state('');
  let telegramDialCode = $state('');

  // Removal state
  let isRemoving = $state(false);

  // 60-second frontend cooldown
  let cooldownSeconds = $state(0);
  let cooldownInterval: ReturnType<typeof setInterval> | null = null;

  type CaptchaProvider = 'turnstile' | 'hcaptcha';

  const selectedRegion = $derived(
    data.regions.find((region) => region.dialCode === countryCode) ?? null
  );
  const selectedMethod = $derived<'sms' | 'telegram'>(selectedRegion?.method ?? 'sms');

  function regionName(region: Region): string {
    const locale = getLocale();
    return (
      region.name[locale] ??
      region.name[locale.split('-')[0]] ??
      region.name.en ??
      Object.values(region.name).find(Boolean) ??
      ''
    );
  }

  // Turnstile
  let turnstileToken = $state('');
  let turnstileWidgetId: string | null = null;
  let turnstileContainer = $state<HTMLDivElement | null>(null);

  // hCaptcha
  let hcaptchaToken = $state('');
  let hcaptchaWidgetId: string | null = null;
  let hcaptchaContainer = $state<HTMLDivElement | null>(null);

  const defaultCaptchaProvider = $derived<CaptchaProvider | null>(
    data.turnstileSiteKey ? 'turnstile' : data.hcaptchaSiteKey ? 'hcaptcha' : null
  );

  let activeCaptchaProvider = $state<CaptchaProvider | null>(null);
  let showCaptchaSwitch = $state(false);

  const hasCaptchaFallback = $derived(Boolean(data.turnstileSiteKey && data.hcaptchaSiteKey));
  const activeCaptchaToken = $derived.by(() => {
    if (activeCaptchaProvider === 'turnstile') return turnstileToken;
    if (activeCaptchaProvider === 'hcaptcha') return hcaptchaToken;
    return '';
  });

  $effect(() => {
    const preferredProvider = defaultCaptchaProvider;

    if (!preferredProvider) {
      activeCaptchaProvider = null;
      return;
    }

    if (activeCaptchaProvider === null) {
      activeCaptchaProvider = preferredProvider;
      return;
    }

    if (activeCaptchaProvider === 'turnstile' && !data.turnstileSiteKey) {
      activeCaptchaProvider = preferredProvider;
      return;
    }

    if (activeCaptchaProvider === 'hcaptcha' && !data.hcaptchaSiteKey) {
      activeCaptchaProvider = preferredProvider;
    }
  });

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

  type HCaptchaWindow = typeof window & {
    hcaptcha?: {
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
      reset: (id?: string) => void;
      getResponse: (id?: string) => string;
    };
    onloadHCaptchaCallback?: () => void;
  };

  $effect(() => {
    if (activeCaptchaProvider !== 'turnstile' || !data.turnstileSiteKey || !turnstileContainer) {
      return;
    }

    const w = window as TurnstileWindow;
    const sitekey = data.turnstileSiteKey;
    const container = turnstileContainer;
    let disposed = false;

    const doRender = () => {
      if (disposed || turnstileWidgetId !== null || !w.turnstile) return;
      turnstileWidgetId = w.turnstile.render(container, {
        sitekey,
        callback: (token: string) => {
          if (disposed) return;
          turnstileToken = token;
        },
        'expired-callback': () => {
          if (disposed) return;
          turnstileToken = '';
        },
        'error-callback': () => {
          if (disposed) return;
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

    return () => {
      disposed = true;
      turnstileToken = '';
      turnstileWidgetId = null;
      container.innerHTML = '';
    };
  });

  $effect(() => {
    if (activeCaptchaProvider !== 'hcaptcha' || !data.hcaptchaSiteKey || !hcaptchaContainer) {
      return;
    }

    const w = window as HCaptchaWindow;
    const sitekey = data.hcaptchaSiteKey;
    const container = hcaptchaContainer;
    let disposed = false;

    const doRender = () => {
      if (disposed || hcaptchaWidgetId !== null || !w.hcaptcha) return;
      hcaptchaWidgetId = w.hcaptcha.render(container, {
        sitekey,
        callback: (token: string) => {
          if (disposed) return;
          hcaptchaToken = token;
        },
        'expired-callback': () => {
          if (disposed) return;
          hcaptchaToken = '';
        },
        'error-callback': () => {
          if (disposed) return;
          hcaptchaToken = '';
        },
        size: 'normal'
      });
    };

    if (w.hcaptcha) {
      doRender();
    } else {
      const prev = w.onloadHCaptchaCallback;
      w.onloadHCaptchaCallback = () => {
        if (prev) prev();
        doRender();
      };

      if (!document.querySelector('script[data-hcaptcha]')) {
        const script = document.createElement('script');
        script.src =
          'https://js.hcaptcha.com/1/api.js?onload=onloadHCaptchaCallback&render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.hcaptcha = '1';
        document.head.appendChild(script);
      }
    }

    return () => {
      disposed = true;
      hcaptchaToken = '';
      hcaptchaWidgetId = null;
      container.innerHTML = '';
    };
  });

  $effect(() => {
    if (!hasCaptchaFallback || codeSent || !activeCaptchaProvider || activeCaptchaToken) {
      showCaptchaSwitch = false;
      return;
    }

    showCaptchaSwitch = false;
    const timeout = setTimeout(() => {
      showCaptchaSwitch = true;
    }, 8000);

    return () => {
      clearTimeout(timeout);
      showCaptchaSwitch = false;
    };
  });

  $effect(() => {
    // Discard an in-flight Telegram verification session as soon as the
    // user edits the phone number or switches the dial code.
    if (
      telegramSession &&
      (phoneNumber.trim() !== telegramPhone || countryCode.trim() !== telegramDialCode)
    ) {
      stopTelegramPolling();
      telegramSession = null;
    }
  });

  $effect(() => {
    return () => {
      if (cooldownInterval) {
        clearInterval(cooldownInterval);
      }
      stopTelegramPolling();
    };
  });

  function resetTurnstile() {
    const w = window as TurnstileWindow;
    if (w.turnstile && turnstileWidgetId !== null) {
      w.turnstile.reset(turnstileWidgetId);
    }
    turnstileToken = '';
  }

  function resetHcaptcha() {
    const w = window as HCaptchaWindow;
    if (w.hcaptcha && hcaptchaWidgetId !== null) {
      w.hcaptcha.reset(hcaptchaWidgetId);
    }
    hcaptchaToken = '';
  }

  function resetActiveCaptcha() {
    if (activeCaptchaProvider === 'turnstile') {
      resetTurnstile();
    } else if (activeCaptchaProvider === 'hcaptcha') {
      resetHcaptcha();
    }
  }

  function switchCaptchaProvider() {
    if (!hasCaptchaFallback || !activeCaptchaProvider) return;

    if (activeCaptchaProvider === 'turnstile') {
      resetTurnstile();
      turnstileWidgetId = null;
      activeCaptchaProvider = 'hcaptcha';
      return;
    }

    resetHcaptcha();
    hcaptchaWidgetId = null;
    activeCaptchaProvider = 'turnstile';
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

  function stopTelegramPolling() {
    if (telegramPollTimer) {
      clearInterval(telegramPollTimer);
      telegramPollTimer = null;
    }
  }

  async function pollTelegramStatus(sessionId: string) {
    try {
      const res = await fetch(
        `/api/phone/status/${encodeURIComponent(sessionId)}?locale=${getLocale()}`
      );

      if (!res.ok) {
        stopTelegramPolling();
        telegramSession = null;
        toast(m.phone_settings_error(), { type: 'error' });
        return;
      }

      const body = (await res.json()) as {
        status: 'pending' | 'verified' | 'expired';
      };

      if (body.status === 'verified') {
        stopTelegramPolling();
        telegramSession = null;
        toast(m.phone_settings_verify_success(), { type: 'success' });
        await invalidateAll();
        return;
      }

      if (body.status === 'expired' || Date.now() > telegramExpiresAt) {
        stopTelegramPolling();
        telegramSession = null;
        toast(m.phone_settings_telegram_expired(), { type: 'error' });
        return;
      }
      // 'pending' — keep polling
    } catch {
      // Transient network error — keep polling.
    }
  }

  function startTelegramPolling(session: { sessionId: string; ttl: number }) {
    telegramExpiresAt = Date.now() + session.ttl * 1000;
    stopTelegramPolling();
    telegramPollTimer = setInterval(() => {
      if (!telegramSession) {
        stopTelegramPolling();
        return;
      }
      pollTelegramStatus(telegramSession.sessionId);
    }, 2500);
  }

  const handleSendCode = async () => {
    const trimmedPhone = phoneNumber.trim();
    const trimmedDialCode = countryCode.trim();

    if (!trimmedPhone || !trimmedDialCode) {
      toast(m.validation_error(), { type: 'error' });
      return;
    }

    // Client-side uniqueness check: same as current bound number
    if (data.phone === trimmedPhone && data.phoneDialCode === trimmedDialCode) {
      toast(m.phone_settings_already_yours(), { type: 'error' });
      return;
    }

    // Captcha is only required for the first send of a flow — re-requesting
    // a Telegram session while one is in flight doesn't need a fresh token.
    if (activeCaptchaProvider && !activeCaptchaToken && !telegramSession) {
      toast(m.phone_settings_captcha_failed(), { type: 'error' });
      return;
    }

    isSending = true;

    try {
      const res = await fetch('/api/phone/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: trimmedPhone,
          dialCode: trimmedDialCode,
          locale: getLocale(),
          ...(activeCaptchaProvider
            ? {
                captchaProvider: activeCaptchaProvider,
                captchaToken: activeCaptchaToken
              }
            : {})
        })
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'phone_already_yours') {
          toast(m.phone_settings_already_yours(), { type: 'error' });
        } else {
          toast(m.phone_settings_taken(), { type: 'error' });
        }
        resetActiveCaptcha();
        return;
      }

      if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'cooldown') {
          startCooldown(body.retryAfter ?? 60);
          toast(m.phone_settings_cooldown({ seconds: body.retryAfter ?? 60 }), { type: 'error' });
        } else {
          toast(m.phone_settings_daily_limit(), { type: 'error' });
        }
        resetActiveCaptcha();
        return;
      }

      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        if (
          body.error === 'turnstile_failed' ||
          body.error === 'turnstile_missing' ||
          body.error === 'captcha_failed' ||
          body.error === 'captcha_missing' ||
          body.error === 'captcha_provider_invalid'
        ) {
          toast(m.phone_settings_captcha_failed(), { type: 'error' });
          resetActiveCaptcha();
          return;
        }
      }

      if (!res.ok) {
        toast(m.phone_settings_error(), { type: 'error' });
        resetActiveCaptcha();
        return;
      }

      const body = (await res.json()) as
        | { success: true; method: 'sms' }
        | {
            success: true;
            method: 'telegram';
            sessionId: string;
            deepLink: string;
            expiresAt: string;
            ttl: number;
          };

      if (body.method === 'telegram') {
        // Start the Telegram verification flow: hand the deep link to the
        // user and poll the session status until verified or expired.
        telegramPhone = trimmedPhone;
        telegramDialCode = trimmedDialCode;
        telegramSession = {
          sessionId: body.sessionId,
          deepLink: body.deepLink,
          expiresAt: body.expiresAt,
          ttl: body.ttl
        };
        open(body.deepLink, '_blank', 'noopener,noreferrer');
        startTelegramPolling(telegramSession);
      } else {
        codeSent = true;
      }
      startCooldown(60);
    } catch {
      toast(m.phone_settings_error(), { type: 'error' });
      resetActiveCaptcha();
    } finally {
      isSending = false;
    }
  };

  const handleVerify = async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      toast(m.validation_error(), { type: 'error' });
      return;
    }

    isVerifying = true;

    try {
      const res = await fetch('/api/phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneNumber.trim(),
          dialCode: countryCode.trim(),
          code: trimmedCode,
          locale: getLocale()
        })
      });

      if (!res.ok) {
        toast(m.phone_settings_error_invalid(), { type: 'error' });
        return;
      }

      const body = await res.json();
      if (!body.verified) {
        toast(m.phone_settings_error_invalid(), { type: 'error' });
        return;
      }

      code = '';
      codeSent = false;
      toast(m.phone_settings_verify_success(), { type: 'success' });
      await invalidateAll();
    } catch {
      toast(m.phone_settings_error_invalid(), { type: 'error' });
    } finally {
      isVerifying = false;
    }
  };

  const handleRemove = async () => {
    if (!confirm(m.phone_settings_remove_confirm())) return;

    isRemoving = true;

    try {
      const res = await fetch('/api/phone', { method: 'DELETE' });

      if (!res.ok) {
        toast(m.phone_settings_error(), { type: 'error' });
        return;
      }

      toast(m.phone_settings_unbind_success(), { type: 'success' });
      stopTelegramPolling();
      codeSent = false;
      telegramSession = null;
      phoneNumber = '';
      countryCode = '';
      code = '';
      await invalidateAll();
    } catch {
      toast(m.phone_settings_error(), { type: 'error' });
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

  <!-- Current phone number -->
  <section
    class="bg-base-100 grid gap-4 rounded-2xl border border-current/10 p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:p-6"
  >
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-3">
        <h2 class="text-lg font-semibold">{m.phone_settings_current()}</h2>
        {#if !data.phone}
          <span class="badge badge-warning badge-outline">{m.pending_verification()}</span>
        {/if}
      </div>

      {#if data.phone}
        <p class="text-base font-medium">
          <span class="text-current/70">+{data.phoneDialCode}</span>
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
      <div class="mb-4 flex flex-wrap gap-2">
        <label
          class="form-control shrink-0 basis-full gap-2 md:not-lg:max-w-1/4 md:not-lg:basis-1/4 xl:max-w-1/4 xl:basis-1/4"
        >
          <span class="label-text sr-only">{m.phone_settings_country_code_placeholder()}</span>
          <select
            class="select select-bordered w-full"
            bind:value={countryCode}
            autocomplete="tel-country-code"
          >
            <option value="" disabled>{m.phone_settings_country_code_placeholder()}</option>
            {#each data.regions as region (region.regionId)}
              <option value={region.dialCode}>+{region.dialCode} {regionName(region)}</option>
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
          class="btn {selectedMethod === 'telegram'
            ? 'btn-telegram'
            : 'btn-primary'} btn-soft not-sm:btn-circle"
          onclick={handleSendCode}
          disabled={isSending ||
            cooldownSeconds > 0 ||
            !phoneNumber.trim() ||
            !countryCode.trim() ||
            (activeCaptchaProvider !== null &&
              !activeCaptchaToken &&
              !codeSent &&
              !telegramSession)}
        >
          {#if isSending}
            <span class="loading loading-spinner"></span>
          {:else if !(cooldownSeconds > 0)}
            <i class="fa-solid fa-paper-plane"></i>
          {/if}
          {#if cooldownSeconds > 0}
            {cooldownSeconds}s
          {:else}
            <span class="not-sm:hidden">
              {selectedMethod === 'telegram'
                ? m.phone_settings_telegram_verify()
                : m.phone_settings_send_code()}
            </span>
          {/if}
        </button>
      </div>

      {#if activeCaptchaProvider && !codeSent && !telegramSession}
        <div class="flex items-center gap-2">
          <div class="min-w-0">
            {#key activeCaptchaProvider}
              {#if activeCaptchaProvider === 'turnstile' && data.turnstileSiteKey}
                <div bind:this={turnstileContainer} transition:slide></div>
              {:else if activeCaptchaProvider === 'hcaptcha' && data.hcaptchaSiteKey}
                <div bind:this={hcaptchaContainer} transition:slide></div>
              {/if}
            {/key}
          </div>

          {#if showCaptchaSwitch}
            <button
              type="button"
              class="btn btn-ghost btn-square shrink-0"
              onclick={switchCaptchaProvider}
              aria-label={m.phone_settings_captcha_switch()}
              title={m.phone_settings_captcha_switch()}
              transition:slide
            >
              <i class="fa-solid fa-rotate-right"></i>
            </button>
          {/if}
        </div>
      {/if}

      {#if telegramSession}
        <div class="border-primary/20 bg-primary/5 mt-4 rounded-xl border p-4" transition:slide>
          <div class="flex flex-wrap items-center gap-3">
            <span class="loading loading-spinner loading-sm text-primary"></span>
            <p class="flex-1 text-sm">{m.phone_settings_telegram_waiting()}</p>
          </div>
        </div>
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

<style>
  .btn-telegram {
    --btn-color: #24a1de;
  }
</style>
