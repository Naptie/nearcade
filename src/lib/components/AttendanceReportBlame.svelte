<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { adaptiveNewTab, getDisplayName, getFnsLocale } from '$lib/utils';
  import type { User } from '@auth/sveltekit';
  import { formatDistanceToNow } from 'date-fns';
  import { onMount, type Snippet } from 'svelte';

  let {
    reportedAttendance,
    class: klass = '',
    children
  }: {
    reportedAttendance: {
      reportedBy: User | undefined;
      reportedAt: string;
      comment: string | null;
    };
    class?: string;
    children: Snippet;
  } = $props();

  let isTouchscreen = $state(false);
  let displayName = $derived(getDisplayName(reportedAttendance.reportedBy));

  onMount(() => {
    isTouchscreen = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  });
</script>

<button
  class="tooltip group/reported-attendance cursor-pointer {klass}"
  onclick={(e) => {
    e.preventDefault();
    if (isTouchscreen) return;
    window.open(
      resolve('/(main)/users/[id]', {
        id: `@${reportedAttendance.reportedBy!.name}`
      }),
      adaptiveNewTab()
    );
  }}
>
  <div
    class="tooltip-content flex flex-col gap-1"
    class:rounded-xl={reportedAttendance.comment != null}
  >
    <span>
      {@html m.report_details({
        user: isTouchscreen
          ? displayName
          : `<span class="group-hover/reported-attendance:text-primary transition-colors">${displayName}</span>`,
        time: formatDistanceToNow(reportedAttendance.reportedAt, {
          addSuffix: true,
          locale: getFnsLocale(getLocale())
        })
      })}
    </span>
    {#if reportedAttendance.comment}
      <div class="divider -my-1.25"></div>
      <div class="text-xs break-words whitespace-pre-wrap opacity-70">
        {reportedAttendance.comment}
      </div>
    {/if}
  </div>
  {@render children()}
</button>
