<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { invalidateAll } from '$app/navigation';
  import type { User } from '$lib/auth/types';

  interface Props {
    shopId: number;
    user: User;
  }

  let { shopId, user }: Props = $props();

  let isSubmitting = $state(false);
  let isStarred = $derived(user.starredArcades?.includes(shopId) ?? false);

  const toggleStar = async () => {
    if (isSubmitting) return;
    isSubmitting = true;
    try {
      const formData = new FormData();
      formData.append('arcadeId', shopId.toString());
      const response = await fetch(
        resolve('/(main)/settings/starred-arcades') +
          (isStarred ? '?/removeArcade' : '?/addArcade'),
        {
          method: 'POST',
          body: formData
        }
      );
      if (response.ok) {
        await invalidateAll();
      }
    } catch (err) {
      console.log('Error starring arcade:', err);
    } finally {
      isSubmitting = false;
    }
  };
</script>

<button
  class="btn btn-warning btn-soft group"
  class:hover:btn-error={isStarred}
  disabled={isSubmitting}
  onclick={toggleStar}
>
  <span class="loading loading-spinner loading-sm" class:hidden={!isSubmitting}></span>
  <span class:hidden={!isStarred || isSubmitting} class:not-group-hover:hidden={isStarred}>
    <i class="fa-solid fa-trash"></i>
  </span>
  <span
    class:group-hover:hidden={isStarred}
    class:not-group-hover:hidden={!isStarred}
    class:hidden={isSubmitting}
  >
    <i class="fa-solid fa-star"></i>
  </span>
  <span class:hidden={isStarred || isSubmitting} class:group-hover:hidden={!isStarred}>
    <i class="fa-regular fa-star"></i>
  </span>
  <span class:not-group-hover:hidden={isStarred && !isSubmitting} class:hidden={!isStarred}>
    {m.unstar()}
  </span>
  <span class:group-hover:hidden={isStarred} class:hidden={isStarred && isSubmitting}>
    {isStarred ? m.starred() : m.star()}
  </span>
</button>
