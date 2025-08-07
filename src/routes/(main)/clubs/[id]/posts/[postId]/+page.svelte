<script lang="ts">
  import type { PageData } from './$types';
  import PostDetails from '$lib/components/PostDetails.svelte';

  let { data }: { data: PageData } = $props();
</script>

<PostDetails
  post={data.post}
  comments={data.comments}
  userVote={data.userVote}
  currentUserId={data.user?.id}
  organizationType="club"
  organizationName={data.club.name}
  organizationSlug={data.club.slug}
  organizationId={data.club.id}
/>