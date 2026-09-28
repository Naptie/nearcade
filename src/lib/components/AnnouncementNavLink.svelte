<script lang="ts">
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';

  let { class: klass = '', textClass = 'hidden lg:inline' } = $props();

  let unread = $derived(Math.max(0, Number(page.data.navigationCounts?.unreadAnnouncements ?? 0)));
  let badge = $derived(unread > 99 ? '99+' : String(unread));
  let label = $derived(unread > 0 ? `${m.announcements()} (${badge})` : m.announcements());
  let current = $derived(page.url.pathname.startsWith(resolve('/(main)/announcements')));
</script>

<a
  href={resolve('/(main)/announcements')}
  class="btn btn-ghost btn-sm lg:btn-md indicator flex items-center gap-2 {klass}"
  aria-label={label}
  aria-current={current ? 'page' : undefined}
>
  {#if unread > 0}
    <span class="indicator-item badge badge-primary badge-xs top-1 right-1 text-xs">{badge}</span>
  {/if}
  <i class="fa-solid fa-bullhorn fa-lg"></i>
  <span class={textClass}>{m.announcements()}</span>
</a>
