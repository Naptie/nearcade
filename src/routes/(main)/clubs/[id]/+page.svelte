<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { base } from '$app/paths';
  import { browser } from '$app/environment';
  import type { PageData } from './$types';
  import InviteLinkModal from '$lib/components/InviteLinkModal.svelte';
  import RoleManagementModals from '$lib/components/RoleManagementModals.svelte';
  import JoinRequestModal from '$lib/components/JoinRequestModal.svelte';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import PostsList from '$lib/components/PostsList.svelte';
  import { PAGINATION } from '$lib/constants';
  import type { ClubMemberWithUser, Shop } from '$lib/types';
  import { onMount } from 'svelte';
  import { canWriteClubPosts, formatDate, fromPath } from '$lib/utils';

  let { data }: { data: PageData } = $props();

  const tabs = [
    { id: 'members', label: m.members(), icon: 'fa-users' },
    { id: 'arcades', label: m.starred_arcades(), icon: 'fa-gamepad' },
    { id: 'posts', label: m.posts(), icon: 'fa-comments' },
    { id: 'announcements', label: m.announcements(), icon: 'fa-bullhorn' }
  ];

  // Initialize activeTab from URL hash or default to 'members'
  const getInitialTab = () => {
    if (browser) {
      const hash = window.location.hash.substring(1);
      return tabs.find((tab) => tab.id === hash)?.id || 'members';
    }
    return 'members';
  };

  let activeTab = $state(getInitialTab());
  let showInviteModal = $state(false);
  let showJoinRequestModal = $state(false);

  // Role management state
  let showRemoveMemberModal = $state(false);
  let showGrantModeratorModal = $state(false);
  let showRevokeModeratorModal = $state(false);
  let showGrantAdminModal = $state(false);
  let showTransferAdminModal = $state(false);
  let selectedMember = $state<ClubMemberWithUser | null>(null);

  // Infinite scrolling state for members
  let displayedMembers = $state(data.members || []);
  let isLoadingMoreMembers = $state(false);
  let hasMoreMembers = $state((data.members?.length || 0) >= PAGINATION.PAGE_SIZE);
  let currentMembersPage = $state(1);

  // Infinite scrolling state for starred arcades
  let displayedArcades = $state(data.starredArcades || []);
  let isLoadingMoreArcades = $state(false);
  let hasMoreArcades = $state((data.starredArcades?.length || 0) >= PAGINATION.PAGE_SIZE);
  let currentArcadesPage = $state(1);

  // Arcade search state
  let searchQuery = $state('');
  let searchResults = $state<Shop[]>([]);
  let isSearching = $state(false);
  let searchTimeout: ReturnType<typeof setTimeout> | undefined = $state(undefined);
  let showAddArcadeModal = $state(false);

  // Check user privileges
  let userPrivileges = $derived.by(() => {
    if (!data.user) return { canEdit: false, canManage: false };
    return data.userPermissions;
  });

  let canWritePosts = $derived(canWriteClubPosts(data.userPermissions, data.club));

  let radius = $state(10);

  onMount(() => {
    window.dispatchEvent(
      new CustomEvent('nearcade-org-background', {
        detail: { hasCustomBackground: !!data.club.backgroundColor }
      })
    );
    const savedRadius = localStorage.getItem('nearcade-radius');
    if (savedRadius) {
      radius = parseInt(savedRadius);
    }
  });

  // Handle URL hash changes for tab navigation
  $effect(() => {
    if (browser) {
      const handleHashChange = () => {
        const hash = window.location.hash.substring(1);
        const validTab = tabs.find((tab) => tab.id === hash);
        if (validTab) {
          activeTab = validTab.id;
        }
      };

      // Listen for hash changes (browser back/forward)
      window.addEventListener('hashchange', handleHashChange);

      return () => {
        window.removeEventListener('hashchange', handleHashChange);
      };
    }
  });

  // Function to change tab and update URL
  const changeTab = (tabId: string) => {
    activeTab = tabId;
    if (browser) {
      window.history.replaceState(null, '', `#${tabId}`);
    }
  };

  // Infinite scrolling for members
  const loadMoreMembers = async () => {
    if (isLoadingMoreMembers || !hasMoreMembers) return;

    isLoadingMoreMembers = true;
    try {
      const nextPage = currentMembersPage + 1;
      const response = await fetch(
        fromPath(`/api/clubs/${data.club.slug || data.club.id}/members?page=${nextPage}`)
      );

      if (response.ok) {
        const result = (await response.json()) as {
          members: typeof data.members;
          hasMore: boolean;
          page: number;
        };
        const newMembers = result.members;
        displayedMembers = [...displayedMembers, ...newMembers];
        hasMoreMembers = result.hasMore;
        currentMembersPage = nextPage;
      } else {
        console.error('Failed to load more members:', response.statusText);
      }
    } catch (error) {
      console.error('Error loading more members:', error);
    } finally {
      isLoadingMoreMembers = false;
    }
  };

  // Infinite scrolling for starred arcades
  const loadMoreArcades = async () => {
    if (isLoadingMoreArcades || !hasMoreArcades) return;

    isLoadingMoreArcades = true;
    try {
      const nextPage = currentArcadesPage + 1;
      const response = await fetch(
        fromPath(`/api/clubs/${data.club.slug || data.club.id}/arcades?page=${nextPage}`)
      );

      if (response.ok) {
        const result = (await response.json()) as {
          arcades: typeof data.starredArcades;
          hasMore: boolean;
          page: number;
        };
        const newArcades = result.arcades;
        displayedArcades = [...displayedArcades, ...newArcades];
        hasMoreArcades = result.hasMore;
        currentArcadesPage = nextPage;
      } else {
        console.error('Failed to load more arcades:', response.statusText);
      }
    } catch (error) {
      console.error('Error loading more arcades:', error);
    } finally {
      isLoadingMoreArcades = false;
    }
  };

  // Arcade search functions
  const searchArcades = async (query: string) => {
    if (!query.trim()) {
      searchResults = [];
      return;
    }

    isSearching = true;
    try {
      const response = await fetch(fromPath(`/api/shops/search?q=${encodeURIComponent(query)}`));
      if (response.ok) {
        const results = (await response.json()) as { shops: Shop[] };
        searchResults = results.shops || [];
      } else {
        searchResults = [];
      }
    } catch (error) {
      console.error('Error searching arcades:', error);
      searchResults = [];
    } finally {
      isSearching = false;
    }
  };

  const handleSearchInput = () => {
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    searchTimeout = setTimeout(() => {
      searchArcades(searchQuery);
    }, 300);
  };

  const clearSearch = () => {
    searchQuery = '';
    searchResults = [];
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
  };

  // Handle arcade management actions
  const handleArcadeAction = async (action: string, arcadeId: string) => {
    if (!arcadeId) return;

    const formData = new FormData();
    formData.append('clubId', data.club.id);
    formData.append('arcadeId', arcadeId);

    try {
      const response = await fetch(`?/${action}`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        // Refresh the page to update the arcade list
        window.location.reload();
      } else {
        const errorData = (await response.json().catch(() => ({ message: 'Unknown error' }))) as {
          message: string;
        };
        console.error(`Failed to ${action}:`, errorData.message);
        alert(`Failed to ${action}: ${errorData.message}`);
      }
    } catch (error) {
      console.error(`Error during ${action}:`, error);
      alert(`Error during ${action}`);
    }
  };

  // Role management functions
  const openRemoveMemberModal = (member: ClubMemberWithUser) => {
    selectedMember = member;
    showRemoveMemberModal = true;
  };

  const openGrantModeratorModal = (member: ClubMemberWithUser) => {
    selectedMember = member;
    showGrantModeratorModal = true;
  };

  const openRevokeModeratorModal = (member: ClubMemberWithUser) => {
    selectedMember = member;
    showRevokeModeratorModal = true;
  };

  const openGrantAdminModal = (member: ClubMemberWithUser) => {
    selectedMember = member;
    showGrantAdminModal = true;
  };

  const openTransferAdminModal = (member: ClubMemberWithUser) => {
    selectedMember = member;
    showTransferAdminModal = true;
  };

  const closeModals = () => {
    showRemoveMemberModal = false;
    showGrantModeratorModal = false;
    showRevokeModeratorModal = false;
    showGrantAdminModal = false;
    showTransferAdminModal = false;
    selectedMember = null;
  };

  // Handle role management actions with form submission
  const handleRoleAction = async (action: string, memberId: string) => {
    if (!memberId) return;

    const formData = new FormData();
    formData.append('clubId', data.club.id);
    formData.append('userId', memberId);

    try {
      const response = await fetch(`?/${action}`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        window.location.reload();
      } else {
        const errorData = (await response.json().catch(() => ({ message: 'Unknown error' }))) as {
          message: string;
        };
        console.error(`Failed to ${action}:`, errorData.message);
        alert(`Failed to ${action}: ${errorData.message}`);
      }
    } catch (error) {
      console.error(`Error during ${action}:`, error);
      alert(`Error during ${action}`);
    }
  };

  // Check what actions current user can perform on a member
  const canManageMember = (member: ClubMemberWithUser) => {
    if (!userPrivileges.canManage)
      return {
        remove: false,
        grantModerator: false,
        revokeModerator: false,
        grantAdmin: false,
        transferAdmin: false
      };
    if (!member.user || member.user.id === data.user?._id)
      return {
        remove: false,
        grantModerator: false,
        revokeModerator: false,
        grantAdmin: false,
        transferAdmin: false
      };

    const isCurrentUserAdmin = userPrivileges.canManage || false;
    const isCurrentUserModerator = (userPrivileges.canEdit && !userPrivileges.canManage) || false;
    const isCurrentUserSiteAdmin = data.user?.userType === 'site_admin';
    const isMemberAdmin = member.memberType === 'admin';
    const isMemberModerator = member.memberType === 'moderator';
    const isMemberRegular = member.memberType === 'member';

    return {
      remove: (isCurrentUserAdmin && !isMemberAdmin) || (isCurrentUserModerator && isMemberRegular),
      grantModerator: isCurrentUserAdmin && isMemberRegular,
      revokeModerator: isCurrentUserAdmin && isMemberModerator,
      // Site admins can grant admin (without losing their status), regular admins can only transfer
      grantAdmin: isCurrentUserSiteAdmin && !isMemberAdmin,
      transferAdmin: isCurrentUserAdmin && !isCurrentUserSiteAdmin && !isMemberAdmin
    };
  };
</script>

<svelte:head>
  <title>{data.club.name} - {m.app_name()}</title>
  <meta
    name="description"
    content={data.club.description || `${data.club.name} - ${m.meta_description_club()}`}
  />
</svelte:head>

<!-- Club Header -->
<div
  class="relative overflow-hidden pt-12"
  style:background-color={data.club.backgroundColor || ''}
>
  <div class="absolute inset-0 bg-gradient-to-r from-black/20 to-transparent"></div>
  <div class="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
    <div class="flex flex-col items-center gap-6 sm:flex-row">
      <!-- Club Avatar -->
      {#if data.club.avatarUrl || data.university?.avatarUrl}
        <div class="shrink-0">
          <img
            src={data.club.avatarUrl || data.university?.avatarUrl}
            alt="{data.club.avatarUrl ? data.club.name : data.university?.name} {m.logo()}"
            class="h-24 w-24 rounded-full bg-white shadow-lg sm:h-32 sm:w-32"
          />
        </div>
      {/if}

      <!-- Club Info -->
      <div
        class="flex-1 {data.club.backgroundColor
          ? 'text-white'
          : 'text-base-content dark:text-white'}"
      >
        <div class="flex items-center justify-between gap-3">
          <h1 class="text-3xl font-bold sm:text-4xl lg:text-5xl">
            {data.club.name}
          </h1>

          <div class="flex items-center gap-2">
            <!-- Join Button for eligible users -->
            {#if data.user && data.userPermissions.canJoin === 2}
              <button class="btn btn-ghost" onclick={() => (showJoinRequestModal = true)}>
                <i class="fa-solid fa-plus"></i>
                {m.join_club()}
              </button>
            {:else if data.userPermissions.canJoin === 1}
              <div class="badge badge-warning">
                <i class="fa-solid fa-clock"></i>
                {m.join_request_sent()}
              </div>
            {/if}

            <!-- Edit Club Button for privileged users -->
            {#if userPrivileges.canEdit}
              <a
                href="{base}/clubs/{data.club.slug || data.club.id}/edit"
                class="btn btn-circle btn-lg btn-ghost"
                title="{m.edit()} {m.club()}"
                aria-label="{m.edit()} {m.club()}"
              >
                <i class="fa-solid fa-edit"></i>
              </a>
            {/if}
          </div>
        </div>

        {#if data.university}
          <a
            href="{base}/universities/{data.university.slug || data.university.id}"
            class="cursor-pointer text-lg text-white/90 underline decoration-transparent decoration-[1.5px] underline-offset-3 transition-colors hover:text-white hover:decoration-white"
          >
            {data.university.name}
          </a>
        {/if}
      </div>
    </div>
  </div>
</div>

{#snippet sidebar(cls = '')}
  <!-- Sidebar -->
  <div class="md:col-span-3 {cls}">
    <div class="sticky top-4 space-y-6">
      <!-- Club Overview -->
      <div class="bg-base-200 rounded-lg p-4">
        <h3 class="mb-3 flex items-center gap-2 font-semibold">
          <i class="fa-solid fa-info-circle"></i>
          {m.overview()}
        </h3>

        <!-- Basic Information -->
        <div class="space-y-3">
          {#if data.club.description}
            <div>
              <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
                {m.club_introduction()}
              </div>
              <div class="text-sm leading-relaxed">
                {data.club.description}
              </div>
            </div>
            <div class="divider my-2"></div>
          {:else}
            <div>
              <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
                {m.club_introduction()}
              </div>
              <div class="text-base-content/60 text-sm italic">
                {m.no_club_description()}
              </div>
            </div>
            <div class="divider my-2"></div>
          {/if}

          <div>
            <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
              {m.member_count()}
            </div>
            <div class="text-sm font-medium">
              {m.member_count_people({ count: data.stats.totalMembers })}
            </div>
          </div>

          <div>
            <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
              {m.starred_arcades_count()}
            </div>
            <div class="text-sm font-medium">
              {m.starred_arcades_count_shops({ count: data.club.starredArcades.length })}
            </div>
          </div>

          {#if data.club.createdAt}
            <div>
              <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
                {m.registration_date()}
              </div>
              <div class="text-sm font-medium">{formatDate(data.club.createdAt)}</div>
            </div>
          {/if}
        </div>

        <!-- Links -->
        {#if data.club.website}
          <div class="divider my-2"></div>
          <div class="border-base-300">
            <a
              href={data.club.website}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-soft btn-sm hover:bg-primary hover:text-primary-content w-full gap-2 dark:hover:bg-white dark:hover:text-black"
            >
              <i class="fa-solid fa-globe"></i>
              {m.website()}
              <i class="fa-solid fa-external-link fa-xs"></i>
            </a>
          </div>
        {/if}
      </div>

      <!-- Stats -->
      <div class="bg-base-200 rounded-lg p-4">
        <h3 class="mb-3 flex items-center gap-2 font-semibold">
          <i class="fa-solid fa-chart-simple"></i>
          {m.statistics()}
        </h3>
        <div class="grid grid-cols-2 gap-3 text-center">
          <div class="bg-base-100 rounded-lg p-3">
            <div class="text-base-content text-lg font-bold">
              {data.stats.totalMembers}
            </div>
            <div class="text-base-content/60 text-xs">
              {m.members()}
            </div>
          </div>
          <div class="bg-base-100 rounded-lg p-3">
            <div class="text-base-content text-lg font-bold">
              {data.club.starredArcades.length}
            </div>
            <div class="text-base-content/60 text-xs">
              {m.starred_arcades()}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{/snippet}

<!-- Main Content -->
<div class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
  <div class="flex flex-col gap-8 md:grid md:grid-cols-12 md:gap-8">
    {@render sidebar('not-md:hidden')}
    <!-- Main Content Area -->
    <div class="md:col-span-9">
      <!-- Tabs -->
      <div class="tabs tabs-lifted mb-6 overflow-x-auto">
        {#each tabs as tab (tab.id)}
          <button
            class="tab tab-lifted whitespace-nowrap transition-colors"
            class:tab-active={activeTab === tab.id}
            onclick={() => changeTab(tab.id)}
          >
            <i class="fa-solid {tab.icon} mr-2"></i>
            {tab.label}
          </button>
        {/each}
      </div>

      <!-- Tab Content -->
      <div class="bg-base-200 rounded-lg p-6">
        {#if activeTab === 'members'}
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <h3 class="flex items-center gap-2 text-lg font-semibold">
                <i class="fa-solid fa-users"></i>
                {m.members()}
              </h3>
              <div class="flex items-center gap-3">
                <div class="text-base-content/60 text-sm">
                  {m.member_count_people({ count: data.stats.totalMembers })}
                </div>
                {#if userPrivileges.canManage}
                  <button
                    class="btn btn-primary btn-sm btn-soft"
                    onclick={() => (showInviteModal = true)}
                  >
                    <i class="fa-solid fa-plus"></i>
                    {m.invite_members()}
                  </button>
                {/if}
              </div>
            </div>

            <!-- Member List -->
            <div class="bg-base-100 rounded-lg">
              {#if displayedMembers && displayedMembers.length > 0}
                <div class="divide-base-200 divide-y">
                  {#each displayedMembers as member (member.userId)}
                    <div class="flex items-center justify-between p-4">
                      <div>
                        <UserAvatar user={member.user} showName={true} size="md" />
                      </div>

                      <div class="flex items-center gap-2">
                        <!-- Member Type Badge -->
                        <div
                          class="badge {member.memberType === 'admin'
                            ? 'badge-error'
                            : member.memberType === 'moderator'
                              ? 'badge-warning'
                              : 'badge-neutral'} badge-sm text-nowrap"
                        >
                          {member.memberType === 'admin'
                            ? m.admin()
                            : member.memberType === 'moderator'
                              ? m.moderator()
                              : m.member()}
                        </div>

                        <!-- Actions for privileged users -->
                        {#if userPrivileges.canManage && member.user?.id !== data.user?._id}
                          {@const memberActions = canManageMember(member)}
                          {#if memberActions.remove || memberActions.grantModerator || memberActions.revokeModerator || memberActions.grantAdmin || memberActions.transferAdmin}
                            <div class="dropdown dropdown-end">
                              <div
                                tabindex="0"
                                role="button"
                                class="btn btn-ghost btn-circle btn-sm"
                              >
                                <i class="fa-solid fa-ellipsis-vertical"></i>
                              </div>
                              <ul
                                class="dropdown-content menu bg-base-200 rounded-box z-[1] w-64 p-2 shadow"
                              >
                                {#if memberActions.grantModerator}
                                  <li>
                                    <button
                                      onclick={() => openGrantModeratorModal(member)}
                                      class="text-success"
                                    >
                                      <i class="fa-solid fa-user-shield"></i>
                                      {m.grant_moderator()}
                                    </button>
                                  </li>
                                {/if}
                                {#if memberActions.revokeModerator}
                                  <li>
                                    <button
                                      onclick={() => openRevokeModeratorModal(member)}
                                      class="text-warning"
                                    >
                                      <i class="fa-solid fa-user-minus"></i>
                                      {m.revoke_moderator()}
                                    </button>
                                  </li>
                                {/if}
                                {#if memberActions.grantAdmin}
                                  <li>
                                    <button
                                      onclick={() => openGrantAdminModal(member)}
                                      class="text-primary"
                                    >
                                      <i class="fa-solid fa-crown"></i>
                                      {m.grant_admin()}
                                    </button>
                                  </li>
                                {/if}
                                {#if memberActions.transferAdmin}
                                  <li>
                                    <button
                                      onclick={() => openTransferAdminModal(member)}
                                      class="text-info"
                                    >
                                      <i class="fa-solid fa-crown"></i>
                                      {m.transfer_admin()}
                                    </button>
                                  </li>
                                {/if}
                                {#if memberActions.remove}
                                  <li>
                                    <button
                                      onclick={() => openRemoveMemberModal(member)}
                                      class="text-error"
                                    >
                                      <i class="fa-solid fa-user-times"></i>
                                      {m.remove_member()}
                                    </button>
                                  </li>
                                {/if}
                              </ul>
                            </div>
                          {/if}
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>

                {#if hasMoreMembers}
                  <div class="p-4 text-center">
                    <button
                      class="btn btn-ghost btn-sm"
                      onclick={loadMoreMembers}
                      disabled={isLoadingMoreMembers}
                    >
                      {#if isLoadingMoreMembers}
                        <span class="loading loading-spinner loading-sm"></span>
                        {m.loading_members()}
                      {:else}
                        {m.load_more()}
                      {/if}
                    </button>
                  </div>
                {/if}
              {:else}
                <div class="p-6">
                  <div class="py-8 text-center">
                    <i class="fa-solid fa-users text-base-content/30 mb-4 text-5xl"></i>
                    <h4 class="text-lg font-medium">{m.no_members_yet()}</h4>
                    {#if userPrivileges.canManage}
                      <p class="text-base-content/60 mt-2 mb-4">
                        {m.member_management_description()}
                      </p>
                      <button
                        class="btn btn-primary btn-sm btn-soft"
                        onclick={() => (showInviteModal = true)}
                      >
                        <i class="fa-solid fa-plus"></i>
                        {m.invite_members()}
                      </button>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {:else if activeTab === 'arcades'}
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <h3 class="flex items-center gap-2 text-lg font-semibold">
                <i class="fa-solid fa-gamepad"></i>
                {m.starred_arcades()}
              </h3>
              <div class="flex items-center gap-3">
                <div class="text-base-content/60 text-sm">
                  {m.starred_arcades_count_shops({ count: data.club.starredArcades.length })}
                </div>
                {#if userPrivileges.canEdit}
                  <button
                    class="btn btn-primary btn-sm btn-soft"
                    onclick={() => (showAddArcadeModal = true)}
                  >
                    <i class="fa-solid fa-plus"></i>
                    {m.add_arcade()}
                  </button>
                {/if}
              </div>
            </div>

            <!-- Arcade List -->
            <div class="bg-base-100 rounded-lg">
              {#if displayedArcades && displayedArcades.length > 0}
                <div class="divide-base-200 divide-y">
                  {#each displayedArcades as shop (shop.id)}
                    <div class="flex items-center justify-between p-4">
                      <a
                        href="https://map.bemanicn.com/shop/{shop.id}"
                        target="_blank"
                        class="group flex flex-1 items-center gap-3"
                      >
                        <div class="flex-1">
                          <h4 class="group-hover:text-accent font-medium transition-colors">
                            {shop.name}
                          </h4>
                          {#if shop.games && shop.games.length > 0}
                            <div class="mt-1 flex flex-wrap gap-1">
                              {#each shop.games.slice(0, 3) as game (game.id)}
                                <span class="badge badge-xs badge-soft">
                                  {game.name || `Game ${game.id}`}
                                </span>
                              {/each}
                              {#if shop.games.length > 3}
                                <span class="badge badge-xs badge-soft">
                                  +{shop.games.length - 3}
                                </span>
                              {/if}
                            </div>
                          {/if}
                        </div>
                      </a>
                      <div class="flex gap-2">
                        <a
                          href="{base}/discover?longitude={shop.location
                            ?.coordinates[0]}&latitude={shop.location
                            ?.coordinates[1]}&name={shop.name}&radius={radius}"
                          target="_blank"
                          class="btn btn-soft btn-circle btn-sm"
                          title={m.explore_nearby()}
                          aria-label={m.explore_nearby()}
                        >
                          <i class="fa-solid fa-map-location-dot"></i>
                        </a>
                        {#if userPrivileges.canEdit}
                          <button
                            class="btn btn-soft btn-circle btn-sm btn-error"
                            onclick={() => handleArcadeAction('removeArcade', shop.id.toString())}
                            title={m.remove_arcade()}
                            aria-label={m.remove_arcade()}
                          >
                            <i class="fa-solid fa-trash"></i>
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>

                {#if hasMoreArcades}
                  <div class="p-4 text-center">
                    <button
                      class="btn btn-ghost btn-sm"
                      onclick={loadMoreArcades}
                      disabled={isLoadingMoreArcades}
                    >
                      {#if isLoadingMoreArcades}
                        <span class="loading loading-spinner loading-sm"></span>
                        {m.loading()}
                      {:else}
                        {m.load_more()}
                      {/if}
                    </button>
                  </div>
                {/if}
              {:else}
                <div class="p-6">
                  <div class="py-8 text-center">
                    <i class="fa-solid fa-gamepad text-base-content/30 mb-4 text-5xl"></i>
                    <h4 class="text-lg font-medium">{m.no_starred_arcades()}</h4>
                    {#if userPrivileges.canEdit}
                      <p class="text-base-content/60 mt-2 mb-4">
                        {m.add_arcade_to_get_started()}
                      </p>
                      <button
                        class="btn btn-primary btn-sm btn-soft"
                        onclick={() => (showAddArcadeModal = true)}
                      >
                        <i class="fa-solid fa-plus"></i>
                        {m.add_arcade()}
                      </button>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {:else if activeTab === 'posts'}
          <PostsList
            organizationType="club"
            organizationId={data.club.id}
            organizationName={data.club.name}
            organizationSlug={data.club.slug}
            currentUserId={data.user?.id}
            canCreatePost={canWritePosts}
            initialPosts={[]}
          />
        {:else if activeTab === 'announcements'}
          <div class="py-12 text-center">
            <i class="fa-solid fa-bullhorn text-base-content/30 text-4xl"></i>
            <p class="text-base-content/60 mt-4">{m.feature_in_development()}</p>
          </div>
        {/if}
      </div>
    </div>
    {@render sidebar('md:hidden')}
  </div>
</div>

<!-- Invite Link Modal -->
<InviteLinkModal
  bind:isOpen={showInviteModal}
  type="club"
  targetId={data.club.id}
  targetName={data.club.name}
/>

<!-- Role Management Modals -->
<RoleManagementModals
  {showRemoveMemberModal}
  {showGrantModeratorModal}
  {showRevokeModeratorModal}
  {showGrantAdminModal}
  {showTransferAdminModal}
  {selectedMember}
  onClose={closeModals}
  onSubmit={handleRoleAction}
/>

<!-- Add Arcade Modal -->
<div class="modal" class:modal-open={showAddArcadeModal}>
  <div class="modal-box max-w-4xl">
    <div class="mb-6 flex items-center justify-between">
      <h3 class="text-lg font-bold">
        <i class="fa-solid fa-gamepad mr-2"></i>
        {m.add_arcade()}
      </h3>
      <button
        class="btn btn-ghost btn-circle btn-sm"
        onclick={() => {
          showAddArcadeModal = false;
          clearSearch();
        }}
        aria-label={m.close()}
      >
        <i class="fa-solid fa-times"></i>
      </button>
    </div>

    <!-- Search Section -->
    <div class="mb-6">
      <div class="mb-4 flex gap-2">
        <div class="flex-1">
          <input
            type="text"
            placeholder={m.search_arcades_placeholder()}
            class="input input-bordered w-full"
            bind:value={searchQuery}
            oninput={handleSearchInput}
          />
        </div>
        <button
          class="btn btn-ghost"
          onclick={clearSearch}
          disabled={!searchQuery}
          aria-label={m.clear_search()}
        >
          <i class="fa-solid fa-times"></i>
        </button>
      </div>

      {#if isSearching}
        <div class="flex items-center justify-center py-8">
          <span class="loading loading-spinner loading-lg"></span>
        </div>
      {:else if searchResults.length > 0}
        <div class="max-h-96 space-y-2 overflow-y-auto">
          {#each searchResults as shop (shop.id)}
            <div class="bg-base-200 flex items-center justify-between rounded-lg p-3">
              <div class="flex-1">
                <h4 class="font-medium">{shop.name}</h4>
                <p class="text-base-content/60 text-sm">
                  ID: {shop.id}
                </p>
                {#if shop.games && shop.games.length > 0}
                  <div class="mt-1 flex flex-wrap gap-1">
                    {#each shop.games.slice(0, 3) as game (game.id)}
                      <span class="badge badge-xs badge-ghost">
                        {game.name || `Game ${game.id}`}
                      </span>
                    {/each}
                    {#if shop.games.length > 3}
                      <span class="badge badge-xs badge-ghost">
                        +{shop.games.length - 3} more
                      </span>
                    {/if}
                  </div>
                {/if}
              </div>
              {#if !data.club.starredArcades.includes(shop.id.toString())}
                <button
                  class="btn btn-primary btn-sm"
                  onclick={() => {
                    handleArcadeAction('addArcade', shop.id.toString());
                    showAddArcadeModal = false;
                    clearSearch();
                  }}
                >
                  <i class="fa-solid fa-plus"></i>
                  {m.add()}
                </button>
              {:else}
                <span class="badge badge-success">
                  <i class="fa-solid fa-check mr-1"></i>
                  {m.already_added()}
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {:else if searchQuery && !isSearching}
        <div class="text-base-content/60 py-8 text-center">
          <i class="fa-solid fa-search mb-2 text-2xl"></i>
          <p>{m.no_arcades_found()}</p>
        </div>
      {/if}
    </div>

    <div class="modal-action">
      <button
        class="btn"
        onclick={() => {
          showAddArcadeModal = false;
          clearSearch();
        }}
      >
        {m.close()}
      </button>
    </div>
  </div>
</div>

<!-- Join Request Modal -->
<JoinRequestModal
  bind:isOpen={showJoinRequestModal}
  clubId={data.club.id}
  clubName={data.club.name}
  onSuccess={() => {
    // Reload the page to update join request status
    window.location.reload();
  }}
/>
