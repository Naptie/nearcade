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
  organizationType="university"
  organizationName={data.university.name}
  organizationSlug={data.university.slug}
  organizationId={data.university.id}
/>
