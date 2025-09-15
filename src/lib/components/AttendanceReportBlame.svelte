<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { getDisplayName } from '$lib/utils';
  import type { User } from '@auth/sveltekit';
  import { formatDistanceToNow } from 'date-fns';
  import { enUS, zhCN } from 'date-fns/locale';
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
      time: formatDistanceToNow(reportedAttendance.reportedAt, {
        addSuffix: true,
        locale: getLocale() === 'en' ? enUS : zhCN
      })
    })}
  </div>
  {@render children()}
</button>
