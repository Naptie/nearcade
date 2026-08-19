<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import { PostReadability } from '$lib/types';
  import { pageTitle } from '$lib/utils';
  import PostCreateForm from '$lib/components/PostCreateForm.svelte';

  let { data }: { data: PageData } = $props();

  let wideMode = $state(false);

  let backUrl = $derived(
    resolve('/(main)/universities/[id]', { id: data.university.slug || data.university.id }) +
      '#posts'
  );

  const handleCreated = (postId: string) => {
    goto(
      resolve('/(main)/universities/[id]/posts/[postId]', {
        id: data.university.slug || data.university.id,
        postId
      })
    );
  };
</script>

<svelte:head>
  <title>{pageTitle(m.create_post(), data.university.name)}</title>
  <meta name="description" content={m.create_post()} />
</svelte:head>

<div
  class="mx-auto pt-20 pb-5 transition-[max-width] duration-500 ease-in-out sm:px-4 {wideMode
    ? 'max-w-full'
    : 'max-w-7xl'}"
>
  <!-- Back link -->
  <div class="mb-6 not-sm:px-4">
    <a href={backUrl} class="hover:text-primary flex items-center gap-2 text-sm transition-colors">
      <i class="fa-solid fa-arrow-left"></i>
      {m.back_to_posts()}
    </a>
  </div>

  <article class="bg-base-100 rounded-2xl p-6 shadow">
    <PostCreateForm
      organizationType="university"
      organizationId={data.university.id}
      organizationName={data.university.name}
      organizationReadability={data.university.postReadability ?? PostReadability.PUBLIC}
      canManage={data.canManage}
      currentUser={data.user}
      cancelHref={backUrl}
      bind:wideMode
      onCreated={handleCreated}
    />
  </article>
</div>
