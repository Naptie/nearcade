<script lang="ts">
  import { onMount } from 'svelte';
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import PostDetails from '$lib/components/PostDetails.svelte';
  import { markAnnouncementsRead } from '$lib/announcements/client';
  import { toAnnouncementPostView } from '$lib/announcements/view';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  onMount(() => {
    if (!data.unread) return;
    markAnnouncementsRead({ announcementId: data.announcement.id }).catch((error) => {
      console.error('Failed to mark announcement read:', error);
    });
  });
</script>

<PostDetails
  post={toAnnouncementPostView(data.announcement)}
  currentUserId={data.user?.id}
  currentUser={data.user ?? undefined}
  organizationName={m.announcements()}
  canJoinOrganization={false}
  canEdit={data.canManage}
  canManage={data.canManage}
  announcementMode
  backHref={resolve('/(main)/announcements')}
  backLabel={m.back_to_announcements()}
/>
