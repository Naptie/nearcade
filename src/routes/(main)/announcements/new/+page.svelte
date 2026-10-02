<script lang="ts">
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { m } from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/utils';
  import PostCreateForm from '$lib/components/PostCreateForm.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let wideMode = $state(false);
  const backUrl = resolve('/(main)/announcements');

  const handleCreated = (announcementId: string) => {
    goto(resolve('/(main)/announcements/[id]', { id: announcementId }));
  };
</script>

<svelte:head>
  <title>{pageTitle(m.new_announcement(), m.announcements())}</title>
</svelte:head>

<div
  class="mx-auto pt-20 pb-5 transition-[max-width] duration-500 ease-in-out sm:px-4 {wideMode
    ? 'max-w-full'
    : 'max-w-7xl'}"
>
  <div class="mb-6 not-sm:px-4">
    <a href={backUrl} class="hover:text-primary flex items-center gap-2 text-sm transition-colors">
      <i class="fa-solid fa-arrow-left"></i>
      {m.back_to_announcements()}
    </a>
  </div>
  <article class="bg-base-100 rounded-2xl p-6 shadow">
    <PostCreateForm
      variant="announcement"
      submitUrl="/api/announcements"
      currentUser={data.user ?? undefined}
      cancelHref={backUrl}
      bind:wideMode
      onCreated={handleCreated}
    />
  </article>
</div>
