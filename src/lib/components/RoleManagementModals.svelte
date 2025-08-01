<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { UniversityMemberWithUser, ClubMemberWithUser } from '$lib/types';

  type Member = UniversityMemberWithUser | ClubMemberWithUser;

  interface Props {
    // Modal states
    showRemoveMemberModal?: boolean;
    showGrantModeratorModal?: boolean;
    showRevokeModeratorModal?: boolean;
    showGrantAdminModal?: boolean;
    showTransferAdminModal?: boolean;

    // Selected member data
    selectedMember?: Member | null;

    // Callback functions
    onClose?: () => void;
    onSubmit?: (action: string, memberId: string) => void;
  }

  let {
    showRemoveMemberModal = false,
    showGrantModeratorModal = false,
    showRevokeModeratorModal = false,
    showGrantAdminModal = false,
    showTransferAdminModal = false,
    selectedMember = null,
    onClose,
    onSubmit
  }: Props = $props();

  function closeModals() {
    onClose?.();
  }

  function handleSubmit(action: string) {
    if (selectedMember && selectedMember.user && onSubmit) {
      onSubmit(action, selectedMember.user.id);
    }
    closeModals();
  }
</script>

<!-- Remove Member Modal -->
<div class="modal" class:modal-open={showRemoveMemberModal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.remove_member()}</h3>
    <p class="py-4">{m.confirm_remove_member()}</p>
    {#if selectedMember}
      <div class="bg-base-200 mb-4 flex items-center gap-3 rounded-lg p-3">
        <div class="avatar">
          <div class="h-10 w-10 rounded-full">
            {#if selectedMember.user?.image}
              <img src={selectedMember.user.image} alt={selectedMember.user.name || 'User'} />
            {:else}
              <div
                class="bg-primary/20 flex h-full w-full items-center justify-center rounded-full"
              >
                <i class="fa-solid fa-user text-primary"></i>
              </div>
            {/if}
          </div>
        </div>
        <div>
          <div class="font-medium">
            {selectedMember.user.displayName || `@${selectedMember.user.name}`}
          </div>
          <div class="text-base-content/60 text-sm">
            {selectedMember.memberType === 'admin'
              ? m.admin()
              : selectedMember.memberType === 'moderator'
                ? m.moderator()
                : m.member()}
          </div>
        </div>
      </div>
    {/if}
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={closeModals}>
        {m.cancel()}
      </button>
      <button class="btn btn-error" onclick={() => handleSubmit('removeMember')}>
        <i class="fa-solid fa-user-times"></i>
        {m.remove_member()}
      </button>
    </div>
  </div>
</div>

<!-- Grant Moderator Modal -->
<div class="modal" class:modal-open={showGrantModeratorModal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.grant_moderator()}</h3>
    <p class="py-4">{m.confirm_grant_moderator()}</p>
    {#if selectedMember}
      <div class="bg-base-200 mb-4 flex items-center gap-3 rounded-lg p-3">
        <div class="avatar">
          <div class="h-10 w-10 rounded-full">
            {#if selectedMember.user?.image}
              <img src={selectedMember.user.image} alt={selectedMember.user.name || 'User'} />
            {:else}
              <div
                class="bg-primary/20 flex h-full w-full items-center justify-center rounded-full"
              >
                <i class="fa-solid fa-user text-primary"></i>
              </div>
            {/if}
          </div>
        </div>
        <div>
          <div class="font-medium">
            {selectedMember.user.displayName || `@${selectedMember.user.name}`}
          </div>
          <div class="text-base-content/60 text-sm">
            {m.member()} → {m.moderator()}
          </div>
        </div>
      </div>
    {/if}
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={closeModals}>
        {m.cancel()}
      </button>
      <button class="btn btn-success" onclick={() => handleSubmit('grantModerator')}>
        <i class="fa-solid fa-user-shield"></i>
        {m.grant_moderator()}
      </button>
    </div>
  </div>
</div>

<!-- Revoke Moderator Modal -->
<div class="modal" class:modal-open={showRevokeModeratorModal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.revoke_moderator()}</h3>
    <p class="py-4">{m.confirm_revoke_moderator()}</p>
    {#if selectedMember}
      <div class="bg-base-200 mb-4 flex items-center gap-3 rounded-lg p-3">
        <div class="avatar">
          <div class="h-10 w-10 rounded-full">
            {#if selectedMember.user?.image}
              <img src={selectedMember.user.image} alt={selectedMember.user.name || 'User'} />
            {:else}
              <div
                class="bg-primary/20 flex h-full w-full items-center justify-center rounded-full"
              >
                <i class="fa-solid fa-user text-primary"></i>
              </div>
            {/if}
          </div>
        </div>
        <div>
          <div class="font-medium">
            {selectedMember.user.displayName || `@${selectedMember.user.name}`}
          </div>
          <div class="text-base-content/60 text-sm">
            {m.moderator()} → {m.member()}
          </div>
        </div>
      </div>
    {/if}
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={closeModals}>
        {m.cancel()}
      </button>
      <button class="btn btn-warning" onclick={() => handleSubmit('revokeModerator')}>
        <i class="fa-solid fa-user-minus"></i>
        {m.revoke_moderator()}
      </button>
    </div>
  </div>
</div>

<!-- Transfer Admin Modal -->
<div class="modal" class:modal-open={showTransferAdminModal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.transfer_admin()}</h3>
    <p class="py-4">{m.confirm_transfer_admin()}</p>
    {#if selectedMember}
      <div class="bg-base-200 mb-4 flex items-center gap-3 rounded-lg p-3">
        <div class="avatar">
          <div class="h-10 w-10 rounded-full">
            {#if selectedMember.user?.image}
              <img src={selectedMember.user.image} alt={selectedMember.user.name || 'User'} />
            {:else}
              <div
                class="bg-primary/20 flex h-full w-full items-center justify-center rounded-full"
              >
                <i class="fa-solid fa-user text-primary"></i>
              </div>
            {/if}
          </div>
        </div>
        <div>
          <div class="font-medium">
            {selectedMember.user.displayName || `@${selectedMember.user.name}`}
          </div>
          <div class="text-base-content/60 text-sm">
            {selectedMember.memberType === 'moderator' ? m.moderator() : m.member()} → {m.admin()}
          </div>
        </div>
      </div>
    {/if}
    <div class="alert alert-warning mb-4">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>{m.confirm_transfer_admin()}</span>
    </div>
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={closeModals}>
        {m.cancel()}
      </button>
      <button class="btn btn-info" onclick={() => handleSubmit('transferAdmin')}>
        <i class="fa-solid fa-crown"></i>
        {m.transfer_admin()}
      </button>
    </div>
  </div>
</div>

<!-- Grant Admin Modal -->
<div class="modal" class:modal-open={showGrantAdminModal}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.grant_admin()}</h3>
    <p class="py-4">{m.confirm_grant_admin()}</p>
    {#if selectedMember}
      <div class="bg-base-200 mb-4 flex items-center gap-3 rounded-lg p-3">
        <div class="avatar">
          <div class="h-10 w-10 rounded-full">
            {#if selectedMember.user?.image}
              <img src={selectedMember.user.image} alt={selectedMember.user.name || 'User'} />
            {:else}
              <div
                class="bg-primary/20 flex h-full w-full items-center justify-center rounded-full"
              >
                <i class="fa-solid fa-user text-primary"></i>
              </div>
            {/if}
          </div>
        </div>
        <div>
          <div class="font-medium">
            {selectedMember.user.displayName || `@${selectedMember.user.name}`}
          </div>
          <div class="text-base-content/60 text-sm">
            {selectedMember.memberType === 'moderator' ? m.moderator() : m.member()} → {m.admin()}
          </div>
        </div>
      </div>
    {/if}
    <div class="modal-action">
      <button class="btn btn-ghost" onclick={closeModals}>
        {m.cancel()}
      </button>
      <button class="btn btn-success" onclick={() => handleSubmit('grantAdmin')}>
        <i class="fa-solid fa-crown"></i>
        {m.grant_admin()}
      </button>
    </div>
  </div>
</div>
