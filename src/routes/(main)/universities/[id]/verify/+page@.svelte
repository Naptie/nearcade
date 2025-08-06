<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import NavigationBar from '$lib/components/NavigationBar.svelte';
  import Footer from '$lib/components/Footer.svelte';
  import { formatDateTime } from '$lib/utils';

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

  const targetEmail = 'verify@nearcade.phi.zone';

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
    <h1 class="text-4xl font-bold">{m.verify_title({ university: data.university.name })}</h1>
    <p class="text-base-content/80">
      {@html m.verification_instruction({
        suffix: `<span class="text-success font-semibold">${domain}</span>`,
        email: `<a href="mailto:${targetEmail}" class="link-accent transition-colors">${targetEmail}</a>`
      })}
    </p>
  </div>
  <div class="flex flex-col items-center gap-2">
    <div
      class="bg-base-200/60 dark:bg-base-200/90 bg-opacity-30 flex flex-col gap-2 rounded-xl border p-4 backdrop-blur-2xl dark:border-neutral-700 dark:shadow-neutral-700/70"
    >
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
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <code
          class="cursor-copy font-semibold break-all transition-colors"
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
        <!-- svelte-ignore a11y_click_events_have_key_events -->
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
    </div>
    <div class="flex">
      <span class="label text-sm">{m.expires()}: {formatDateTime(data.expires)}</span>
    </div>
  </div>
  <Footer />
</div>
