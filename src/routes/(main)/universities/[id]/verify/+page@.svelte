<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import NavigationBar from '$lib/components/NavigationBar.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import { formatDateTime } from '$lib/utils';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { base } from '$app/paths';

  let { data }: { data: PageData } = $props();

  let copied: string | null = $state(null);
  let lastCopied: Date | null = $state(null);

  let domain = $derived.by(() => {
    const hostname = new URL(data.university.website || '').hostname;
    const parts = hostname.split('.');
    return parts.length > 2 ? parts.slice(1).join('.') : hostname;
  });

  let title = $derived(`[nearcade] SSV ${m.verification_email_title()}`);
  let body = $derived(`UNIV: ${data.university.id}\nUSER: ${data.user.id}\nHMAC: ${data.hmac}`);

  const sendTo = 'verify@nearcade.phi.zone';

  const copy = (content: string) => {
    if (copied === content) return; // Avoid redundant copy actions
    navigator.clipboard.writeText(content);
    copied = content;
    const date = new Date();
    lastCopied = date;
    setTimeout(() => {
      if (lastCopied === date) {
        copied = null; // Reset copied state after 2 seconds
        lastCopied = null;
      }
    }, 2000);
  };

  onMount(() => {
    if (data.status !== 'success') {
      const interval = setInterval(() => {
        if (data.status === 'success') {
          clearInterval(interval);
        } else {
          invalidateAll();
        }
      }, 10000);
    }
  });
</script>

<svelte:head>
  <title
    >{data.userPermissions.canJoin === 2 ? m.verify_and_join() : m.verify()} - {data.university
      .name} - {m.app_name()}</title
  >
</svelte:head>

<NavigationBar />

<div
  class="container mx-auto flex min-h-screen flex-col items-center justify-center gap-6 py-20 sm:px-4"
>
  <div class="flex flex-col items-center gap-2 text-center">
    <h1 class="text-4xl font-bold">
      {@html m.verify_title({
        university: `<a href="${base}/universities/${data.university.slug || data.university.id}" class="hover:text-accent transition-colors">${data.university.name}</a>`
      })}
    </h1>
    {#if !data.verificationEmail}
      <p class="text-base-content/80">
        {@html m.verification_instruction({
          suffix: `<span class="text-success font-semibold">${domain}</span>`,
          email: `<a href="mailto:${sendTo}" class="link-accent transition-colors">${sendTo}</a>`
        })}
      </p>
    {/if}
  </div>
  <div class="flex flex-col items-center gap-2">
    <div
      class="bg-base-200/60 dark:bg-base-200/90 bg-opacity-30 border-base-300 flex flex-col gap-2 rounded-xl border p-4 shadow-none backdrop-blur-2xl transition hover:shadow-lg dark:border-neutral-700 dark:shadow-neutral-700/70"
    >
      {#if data.verificationEmail}
        <div class="flex flex-col items-center">
          <span>{m.student_status_verified()}</span>
          <span class="text-success text-2xl font-semibold">{data.verificationEmail}</span>
        </div>
      {:else}
        <div class="flex flex-col">
          <div class="flex items-center justify-between gap-1">
            <span class="label">{m.send_to()}</span>
            <button
              class="btn btn-xs not-lg:btn-circle btn-soft btn-primary"
              disabled={copied === sendTo}
              onclick={() => copy(sendTo)}
            >
              {#if copied === sendTo}
                <i class="fa-solid fa-check"></i>
                <span class="not-lg:hidden">{m.copied()}</span>
              {:else}
                <i class="fa-solid fa-copy"></i>
                <span class="not-lg:hidden">{m.copy()}</span>
              {/if}
            </button>
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <code
            class="cursor-copy font-semibold break-all transition-colors"
            class:hover:text-accent={copied !== sendTo}
            class:text-success={copied === sendTo}
            onmousedown={() => copy(sendTo)}
            onmouseup={() => copy(sendTo)}
          >
            {sendTo}
          </code>
        </div>
        <div class="flex flex-col">
          <div class="flex items-center justify-between gap-1">
            <span class="label">{m.title()}</span>
            <button
              class="btn btn-xs not-lg:btn-circle btn-soft btn-primary"
              disabled={copied === title}
              onclick={() => copy(title)}
            >
              {#if copied === title}
                <i class="fa-solid fa-check"></i>
                <span class="not-lg:hidden">{m.copied()}</span>
              {:else}
                <i class="fa-solid fa-copy"></i>
                <span class="not-lg:hidden">{m.copy()}</span>
              {/if}
            </button>
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <code
            class="cursor-copy font-bold break-all transition-colors"
            class:hover:text-accent={copied !== title}
            class:text-success={copied === title}
            onmousedown={() => copy(title)}
            onmouseup={() => copy(title)}
          >
            {title}
          </code>
        </div>
        <div class="flex flex-col">
          <div class="flex items-center justify-between gap-1">
            <span class="label">{m.body()}</span>
            <button
              class="btn btn-xs not-lg:btn-circle btn-soft btn-primary"
              disabled={copied === body}
              onclick={() => copy(body)}
            >
              {#if copied === body}
                <i class="fa-solid fa-check"></i>
                <span class="not-lg:hidden">{m.copied()}</span>
              {:else}
                <i class="fa-solid fa-copy"></i>
                <span class="not-lg:hidden">{m.copy()}</span>
              {/if}
            </button>
          </div>
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <code
            class="cursor-copy break-all whitespace-pre-line transition-colors"
            class:hover:text-accent={copied !== body}
            class:text-success={copied === body}
            onmousedown={() => copy(body)}
            onmouseup={() => copy(body)}
          >
            {body}
          </code>
        </div>
      {/if}
    </div>
    {#if !data.verificationEmail}
      <div class="flex items-center text-sm">
        <span class="label">{m.expires()}: {formatDateTime(data.expires)}</span>
        <div class="divider divider-horizontal"></div>
        <div
          class={data.status && data.status !== 'success' && data.status !== 'processing'
            ? 'tooltip tooltip-bottom tooltip-error'
            : ''}
          data-tip={data.status && data.status !== 'success' && data.status !== 'processing'
            ? m[`${data.status}_description`]()
            : ''}
        >
          <span class="label">{m.status()}: </span>
          <span
            class={data.status && data.status !== 'processing'
              ? data.status === 'success'
                ? 'text-success'
                : 'text-error'
              : 'text-info inline-flex items-center gap-1'}
          >
            {m[data.status || 'waiting_for_email']()}
            {#if !data.status || data.status === 'processing'}
              <span class="loading loading-spinner loading-xs"></span>
            {/if}
          </span>
        </div>
      </div>
    {/if}
  </div>
  <Footer />
</div>
