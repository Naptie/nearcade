<script lang="ts">
  import { auditStatusColor, auditStatusLabel } from '$lib/ugc/labels';
  import { presentStatuses, type UgcHashSummary } from '../types';

  let { item }: { item: UgcHashSummary } = $props();
</script>

{#each presentStatuses(item) as status (status)}
  <div class="join">
    <span class="badge badge-sm badge-soft join-item text-{auditStatusColor(status)}">
      {auditStatusLabel(status)}</span
    >
    <span class="badge badge-sm badge-soft join-item badge-{auditStatusColor(status)}">
      {item.statusCounts[status]}</span
    >
  </div>
{/each}
