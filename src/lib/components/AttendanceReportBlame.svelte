<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { getDisplayName, formatTime } from '$lib/utils';
  import type { User } from '@auth/sveltekit';
  import type { Snippet } from 'svelte';

  let {
    reportedAttendance,
    class: klass = '',
    children
  }: {
    reportedAttendance: {
      reportedBy: User | undefined;
      reportedAt: string;
    };
    class?: string;
    children: Snippet;
  } = $props();
</script>

<button
  class="tooltip group/reported-attendance cursor-pointer {klass}"
  onclick={(e) => {
    e.preventDefault();
    window.open(
      resolve('/(main)/users/[id]', {
        id: `@${reportedAttendance.reportedBy!.name}`
      }),
      '_blank'
    );
  }}
>
  <div class="tooltip-content">
    {@html m.report_details({
      user: `<span class="group-hover/reported-attendance:text-primary transition-colors">${getDisplayName(
        reportedAttendance.reportedBy
      )}</span>`,
      time: formatTime(reportedAttendance.reportedAt)
    })}
  </div>
  {@render children()}
</button>
