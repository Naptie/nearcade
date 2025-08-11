<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { browser } from '$app/environment';
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';
  import type { Campus, UniversityMemberWithUser } from '$lib/types';
  import CampusEditModal from '$lib/components/CampusEditModal.svelte';
  import InviteLinkModal from '$lib/components/InviteLinkModal.svelte';
  import RoleManagementModals from '$lib/components/RoleManagementModals.svelte';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import ChangelogView from '$lib/components/ChangelogView.svelte';
  import PostsList from '$lib/components/PostsList.svelte';
  import { base } from '$app/paths';
  import { PAGINATION } from '$lib/constants';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { canWriteUnivPosts, fromPath } from '$lib/utils';
  import VerifiedCheckMark from '$lib/components/VerifiedCheckMark.svelte';

  let { data }: { data: PageData } = $props();

  const tabs = [
    { id: 'posts', label: m.posts(), icon: 'fa-comments' },
    { id: 'campuses', label: m.campuses(), icon: 'fa-building' },
    { id: 'clubs', label: m.clubs(), icon: 'fa-users' },
    { id: 'members', label: m.members(), icon: 'fa-user' },
    { id: 'changelog', label: m.changelog(), icon: 'fa-clock-rotate-left' }
  ];

  // Initialize activeTab from URL hash or default to 'posts'
  const getInitialTab = () => {
    const hash = page.url.hash.substring(1);
    return (tabs.find((tab) => tab.id === hash) || tabs[0]).id;
  };

  let activeTab = $state(getInitialTab());
  let isCampusModalOpen = $state(false);
  let editingCampus = $state<Campus | null>(null);
  let showDeleteConfirm = $state(false);
  let deletingCampusId = $state('');
  let searchRadius = $state(10); // Default 10km
  let showInviteModal = $state(false);

  // Role management state
  let showRemoveMemberModal = $state(false);
  let showGrantModeratorModal = $state(false);
  let showRevokeModeratorModal = $state(false);
  let showGrantAdminModal = $state(false);
  let showTransferAdminModal = $state(false);
  let selectedMember = $state<UniversityMemberWithUser | null>(null);

  // Infinite scrolling state
  let displayedMembers = $state(data.members || []);
  let displayedClubs = $state(data.clubs || []);
  let isLoadingMoreMembers = $state(false);
  let isLoadingMoreClubs = $state(false);
  let hasMoreMembers = $state((data.members?.length || 0) >= PAGINATION.PAGE_SIZE);
  let hasMoreClubs = $state((data.clubs?.length || 0) >= PAGINATION.PAGE_SIZE);
  let currentMembersPage = $state(1);
  let currentClubsPage = $state(1);

  // Check user privileges
  let userPrivileges = $derived.by(() => {
    if (!data.user) return { canEdit: false, canManage: false };
    return data.userPermissions;
  });

  // Check if user can write posts based on university postWritability setting
  let canWritePosts = $derived(canWriteUnivPosts(data.userPermissions, data.university));

  // Load search radius from localStorage
  onMount(() => {
    if (browser) {
      window.dispatchEvent(
        new CustomEvent('nearcade-org-background', {
          detail: { hasCustomBackground: !!data.university.backgroundColor }
        })
      );
      const savedRadius = localStorage.getItem('nearcade-radius');
      if (savedRadius) {
        searchRadius = parseInt(savedRadius, 10) || 10;
      }
    }
  });

  // Handle URL hash changes for tab navigation
  $effect(() => {
    if (browser) {
      const handleHashChange = () => {
        const hash = window.location.hash.substring(1);
        const validTab = tabs.find((tab) => tab.id === hash);
        if (validTab) {
          console.log(114514);
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

  // Handle campus operations
  const openAddCampusModal = () => {
    editingCampus = null;
    isCampusModalOpen = true;
  };

  const openEditCampusModal = (campus: Campus) => {
    editingCampus = campus;
    isCampusModalOpen = true;
  };

  const confirmDeleteCampus = (campusId: string) => {
    deletingCampusId = campusId;
    showDeleteConfirm = true;
  };

  // Infinite scrolling functions
  const loadMoreMembers = async () => {
    if (isLoadingMoreMembers || !hasMoreMembers) return;

    isLoadingMoreMembers = true;
    try {
      const nextPage = currentMembersPage + 1;
      const response = await fetch(
        fromPath(`/api/universities/${data.university.id}/members?page=${nextPage}`)
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

  const loadMoreClubs = async () => {
    if (isLoadingMoreClubs || !hasMoreClubs) return;

    isLoadingMoreClubs = true;
    try {
      const nextPage = currentClubsPage + 1;
      const response = await fetch(
        fromPath(`/api/universities/${data.university.id}/clubs?page=${nextPage}`)
      );
      if (response.ok) {
        const result = (await response.json()) as {
          clubs: typeof data.clubs;
          hasMore: boolean;
          page: number;
        };
        const newClubs = result.clubs;
        displayedClubs = [...displayedClubs, ...newClubs];
        hasMoreClubs = result.hasMore;
        currentClubsPage = nextPage;
      } else {
        console.error('Failed to load more clubs:', response.statusText);
      }
    } catch (error) {
      console.error('Error loading more clubs:', error);
    } finally {
      isLoadingMoreClubs = false;
    }
  };

  // Role management functions
  const openRemoveMemberModal = (member: UniversityMemberWithUser) => {
    selectedMember = member;
    showRemoveMemberModal = true;
  };

  const openGrantModeratorModal = (member: UniversityMemberWithUser) => {
    selectedMember = member;
    showGrantModeratorModal = true;
  };

  const openRevokeModeratorModal = (member: UniversityMemberWithUser) => {
    selectedMember = member;
    showRevokeModeratorModal = true;
  };

  const openGrantAdminModal = (member: UniversityMemberWithUser) => {
    selectedMember = member;
    showGrantAdminModal = true;
  };

  const openTransferAdminModal = (member: UniversityMemberWithUser) => {
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
    formData.append('universityId', data.university.id);
    formData.append('userId', memberId);

    try {
      const response = await fetch(`?/${action}`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        // Refresh the page data
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

  // Check what actions current user can perform on a university member
  const canManageMember = (member: UniversityMemberWithUser) => {
    if (!userPrivileges.canManage || !member.user || member.user.id === data.user?.id)
      return {
        remove: false,
        grantModerator: false,
        revokeModerator: false,
        grantAdmin: false,
        transferAdmin: false
      };

    const isCurrentUserAdmin = data.userPermissions?.role === 'admin' || false;
    const isCurrentUserModerator = data.userPermissions?.role === 'moderator' || false;
    const isCurrentUserSiteAdmin = data.user?.userType === 'site_admin';
    const isMemberAdmin = member.memberType === 'admin';
    const isMemberModerator = member.memberType === 'moderator';
    const isMemberRegular = member.memberType === 'student';

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
  <title>{data.university.name} - {m.app_name()}</title>
  <meta name="description" content={data.university.description || data.university.name} />
</svelte:head>

<!-- University Header -->
<div
  class="relative overflow-hidden pt-12"
  style:background-color={data.university.backgroundColor || ''}
>
  <div class="absolute inset-0 bg-gradient-to-r from-black/20 to-transparent"></div>
  <div class="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
    <div class="flex flex-col items-center gap-6 sm:flex-row">
      <!-- University Avatar -->
      {#if data.university.avatarUrl}
        <div class="shrink-0">
          <img
            src={data.university.avatarUrl}
            alt="{data.university.name} {m.logo()}"
            class="h-24 w-24 rounded-full bg-white shadow-lg sm:h-32 sm:w-32"
          />
        </div>
      {/if}

      <!-- University Info -->
      <div
        class="flex flex-1 flex-col items-center justify-between gap-3 sm:flex-row {data.university
          .backgroundColor
          ? 'text-white'
          : 'text-base-content dark:text-white'}"
      >
        <div class="flex flex-col gap-2 not-sm:items-center not-sm:text-center">
          <h1 class="text-3xl font-bold sm:text-4xl lg:text-5xl">
            {data.university.name}
          </h1>

          <div class="flex gap-1 text-nowrap">
            {#if data.university.is985}
              <span class="badge badge-primary badge-sm">{m.badge_985()}</span>
            {/if}
            {#if data.university.is211}
              <span class="badge badge-secondary badge-sm">{m.badge_211()}</span>
            {/if}
            {#if data.university.isDoubleFirstClass}
              <span class="badge badge-accent badge-sm">{m.badge_double_first_class()}</span>
            {/if}
          </div>
        </div>

        <div class="flex items-center gap-2">
          <!-- Join Button for eligible users -->
          {#if data.user && data.userPermissions.canJoin > 0 && !data.userPermissions.verificationEmail}
            <a
              href="{base}/universities/{data.university.slug || data.university.id}/verify"
              class="btn btn-ghost"
            >
              {#if data.userPermissions.canJoin === 2}
                <i class="fa-solid fa-plus"></i>
                {m.verify_and_join()}
              {:else}
                <i class="fa-solid fa-user-check"></i>
                {m.verify()}
              {/if}
            </a>
          {/if}

          <!-- Edit University Button for privileged users -->
          {#if userPrivileges.canEdit}
            <a
              href="{base}/universities/{data.university.slug || data.university.id}/edit"
              class="btn btn-circle btn-lg btn-ghost"
              title={m.edit_university_info()}
              aria-label={m.edit_university_info()}
            >
              <i class="fa-solid fa-edit"></i>
            </a>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

{#snippet sidebar(cls = '')}
  <!-- Sidebar -->
  <div class="md:col-span-3 {cls}">
    <div class="sticky top-4 space-y-6">
      <!-- University Overview -->
      <div class="bg-base-200 rounded-lg p-4">
        <h3 class="mb-3 flex items-center gap-2 font-semibold">
          <i class="fa-solid fa-info-circle"></i>
          {m.overview()}
        </h3>

        <!-- Basic Information -->
        <div class="space-y-3">
          {#if data.university.description}
            <div>
              <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
                {m.school_introduction()}
              </div>
              <div class="text-sm leading-relaxed">
                {data.university.description}
              </div>
            </div>
            <div class="divider my-2"></div>
          {/if}

          <div>
            <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
              {m.school_type()}
            </div>
            <div class="text-sm font-medium">{data.university.type}</div>
          </div>

          <div>
            <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
              {m.discipline_category()}
            </div>
            <div class="text-sm font-medium">
              {data.university.majorCategory || m.uncategorized()}
            </div>
          </div>

          <div>
            <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
              {m.running_nature()}
            </div>
            <div class="text-sm font-medium">
              {data.university.natureOfRunning || m.unknown()}
            </div>
          </div>

          <div>
            <div class="text-base-content/50 mb-1 text-xs tracking-wide uppercase">
              {m.governing_body()}
            </div>
            <div class="text-sm font-medium">{data.university.affiliation}</div>
          </div>
        </div>

        <!-- Links -->
        {#if data.university.website}
          <div class="divider my-2"></div>
          <div class="border-base-300">
            <a
              href={data.university.website}
              target="_blank"
              rel="noopener noreferrer"
              class="btn btn-soft btn-sm hover:bg-primary hover:text-primary-content w-full gap-2 dark:hover:bg-white dark:hover:text-black"
            >
              <i class="fa-solid fa-globe"></i>
              {m.official_website()}
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
              {data.university.campuses.length}
            </div>
            <div class="text-base-content/60 text-xs">
              {m.campuses()}
            </div>
          </div>
          <div class="bg-base-100 rounded-lg p-3">
            <div class="text-base-content text-lg font-bold">
              {data.stats.frequentingArcadesCount}
            </div>
            <div class="text-base-content/60 text-xs">
              {m.frequenting_arcades()}
            </div>
          </div>
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
              {data.stats.clubsCount}
            </div>
            <div class="text-base-content/60 text-xs">
              {m.clubs()}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
{/snippet}

<!-- Main Content -->
<div class="mx-auto max-w-7xl min-w-3xs px-4 py-8 sm:px-6 md:px-8">
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
        {#if activeTab === 'posts'}
          <PostsList
            organizationType="university"
            organizationId={data.university.id}
            organizationName={data.university.name}
            organizationSlug={data.university.slug}
            organizationReadability={data.university.postReadability}
            currentUserId={data.user?.id}
            canManage={userPrivileges.canManage}
            canCreatePost={canWritePosts}
            initialPosts={[]}
          />
        {:else if activeTab === 'campuses'}
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-semibold">{m.campuses()}</h3>

              <!-- Add Campus button for admins -->
              {#if userPrivileges.canManage}
                <button
                  class="btn btn-primary not-xs:btn-circle btn-soft btn-sm"
                  onclick={openAddCampusModal}
                >
                  <i class="fa-solid fa-plus"></i>
                  <span class="not-xs:hidden">{m.add_campus()}</span>
                </button>
              {/if}
            </div>

            <div class="grid gap-4">
              {#each data.university.campuses as campus (campus.id)}
                <div class="bg-base-100 rounded-lg p-4">
                  <div class="flex items-center justify-between">
                    <div class="flex-1">
                      <h4 class="text-lg font-medium">
                        {campus.name || m.main_campus()}
                      </h4>
                      <p class="text-base-content/50 mt-1 text-sm">
                        {campus.address}
                      </p>
                    </div>

                    <div class="flex gap-2">
                      {#if campus.location}
                        <a
                          class="btn not-md:btn-circle btn-soft btn-sm"
                          href="{base}/discover?latitude={campus.location
                            .coordinates[1]}&longitude={campus.location
                            .coordinates[0]}&radius={searchRadius}&name={encodeURIComponent(
                            `${data.university.name}${campus.name ? ` (${campus.name})` : ''}`
                          )}"
                          target="_blank"
                        >
                          <i class="fas fa-map-marker-alt"></i>
                          <span class="not-md:hidden">{m.view_location()}</span>
                        </a>
                      {/if}

                      <!-- Edit Campus Button for admins -->
                      {#if userPrivileges.canEdit}
                        <button
                          class="btn btn-circle btn-soft btn-sm"
                          onclick={() => openEditCampusModal(campus)}
                          title={m.edit_campus_info()}
                          aria-label={m.edit_campus_info()}
                        >
                          <i class="fa-solid fa-edit"></i>
                        </button>
                      {/if}

                      <!-- Delete Campus Button for admins -->
                      {#if userPrivileges.canManage && data.university.campuses.length > 1}
                        <button
                          class="btn btn-circle btn-soft btn-error btn-sm"
                          onclick={() => confirmDeleteCampus(campus.id)}
                          title={m.delete_campus()}
                          aria-label={m.delete_campus()}
                        >
                          <i class="fa-solid fa-trash"></i>
                        </button>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else if activeTab === 'clubs'}
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <h3 class="flex items-center gap-2 text-lg font-semibold">
                <i class="fa-solid fa-users"></i>
                {m.clubs()}
              </h3>
              <div class="flex items-center gap-3">
                <div class="text-base-content/60 text-sm">
                  {data.stats.totalClubs}
                  {m.clubs()}
                </div>
                {#if userPrivileges.canManage}
                  <a
                    href="{base}/clubs/new?university={data.university.id}"
                    class="btn btn-primary not-xs:btn-circle btn-sm btn-soft"
                  >
                    <i class="fa-solid fa-plus"></i>
                    <span class="not-xs:hidden">{m.create_club()}</span>
                  </a>
                {/if}
              </div>
            </div>

            <!-- Club List -->
            <div class="bg-base-100 rounded-lg">
              {#if displayedClubs && displayedClubs.length > 0}
                <div class="divide-base-200 divide-y">
                  {#each displayedClubs as club (club.id)}
                    <a
                      href="{base}/clubs/{club.slug || club.id}"
                      class="group flex items-center justify-between p-4"
                    >
                      <div class="flex items-center gap-3">
                        <div class="avatar {club.avatarUrl ? '' : 'avatar-placeholder'}">
                          <div
                            class="h-12 w-12 rounded-full {club.avatarUrl
                              ? ''
                              : 'bg-neutral text-neutral-content'}"
                          >
                            {#if club.avatarUrl}
                              <img src={club.avatarUrl} alt="{club.name} {m.logo()}" />
                            {:else}
                              <span class="text-base">{club.name.trim()[0]}</span>
                            {/if}
                          </div>
                        </div>
                        <div class="group-hover:text-accent transition-colors">
                          <span class="font-medium">
                            {club.name}
                          </span>
                          {#if club.description}
                            <span class="line-clamp-1 text-sm opacity-60">
                              {club.description}
                            </span>
                          {/if}
                        </div>
                      </div>
                    </a>
                  {/each}
                </div>

                {#if hasMoreClubs}
                  <div class="p-4 text-center">
                    <button
                      class="btn btn-ghost btn-sm"
                      onclick={loadMoreClubs}
                      disabled={isLoadingMoreClubs}
                    >
                      {#if isLoadingMoreClubs}
                        <span class="loading loading-spinner loading-sm"></span>
                        {m.loading_clubs()}
                      {:else}
                        {m.load_more_clubs()}
                      {/if}
                    </button>
                  </div>
                {/if}
              {:else}
                <div class="p-6">
                  <div class="py-8 text-center">
                    <i class="fa-solid fa-users text-base-content/30 mb-4 text-5xl"></i>
                    <h4 class="text-lg font-medium">{m.no_clubs_in_university()}</h4>
                    {#if userPrivileges.canManage}
                      <p class="text-base-content/60 mt-2 mb-4">
                        {m.create_club_to_get_started()}
                      </p>
                      <a
                        href="{base}/clubs/new?university={data.university.id}"
                        class="btn btn-primary btn-sm btn-soft"
                      >
                        <i class="fa-solid fa-plus"></i>
                        {m.create_club()}
                      </a>
                    {:else}
                      <p class="text-base-content/60 mt-2">
                        {m.no_clubs_created_yet()}
                      </p>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {:else if activeTab === 'members'}
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <h3 class="flex items-center gap-2 text-lg font-semibold">
                <i class="fa-solid fa-user"></i>
                {m.members()}
              </h3>
              <div class="flex items-center gap-3">
                <div class="text-base-content/60 text-sm">
                  {m.member_count_people({ count: data.stats.totalMembers })}
                </div>
                {#if userPrivileges.canManage}
                  <button
                    class="btn btn-primary not-xs:btn-circle btn-sm btn-soft"
                    onclick={() => (showInviteModal = true)}
                  >
                    <i class="fa-solid fa-plus"></i>
                    <span class="not-xs:hidden">{m.invite_members()}</span>
                  </button>
                {/if}
              </div>
            </div>

            <!-- Member List -->
            <div class="bg-base-100 rounded-lg">
              {#if displayedMembers && displayedMembers.length > 0}
                <div class="divide-base-200 divide-y">
                  {#each displayedMembers as member (member.userId)}
                    <div class="flex items-center justify-between gap-1 p-4">
                      <div class="flex items-center gap-1 not-sm:overflow-hidden">
                        <UserAvatar user={member.user} showName size="md" />
                        {#if member.verifiedAt}
                          <VerifiedCheckMark
                            href={member.userId === data.user?.id
                              ? `${base}/universities/${data.university.slug || data.university.id}/verify`
                              : ''}
                            class="tooltip-right text-sm"
                          />
                        {/if}
                      </div>

                      <div class="flex items-center gap-1">
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
                        {#if userPrivileges.canManage && member.user.id !== data.user?.id}
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
                    <i class="fa-solid fa-user text-base-content/30 mb-4 text-5xl"></i>
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
        {:else if activeTab === 'changelog'}
          <div class="space-y-6">
            <div class="flex items-center justify-between">
              <h3 class="flex items-center gap-2 text-lg font-semibold">
                <i class="fa-solid fa-clock-rotate-left"></i>
                {m.changelog()}
              </h3>
              <div class="text-base-content/60 not-xs:hidden text-sm">
                {m.track_university_profile_changes()}
              </div>
            </div>

            <!-- Changelog entries -->
            <ChangelogView universityId={data.university.id} />
          </div>
        {/if}
      </div>
    </div>
    {@render sidebar('md:hidden')}
  </div>
</div>

<!-- Campus Edit Modal -->
<CampusEditModal
  bind:open={isCampusModalOpen}
  campus={editingCampus}
  universityId={data.university.id}
  isEditMode={!!editingCampus}
  onSuccess={() => {
    isCampusModalOpen = false;
    editingCampus = null;
  }}
/>

<!-- Delete Campus Confirmation Modal -->
<dialog class="modal" class:modal-open={showDeleteConfirm}>
  <div class="modal-box">
    <h3 class="text-lg font-bold">{m.delete_campus()}</h3>
    <p class="py-4">{m.confirm_delete_campus()}</p>
    <div class="modal-action">
      <button
        class="btn"
        onclick={() => {
          showDeleteConfirm = false;
          deletingCampusId = '';
        }}
      >
        {m.cancel()}
      </button>
      <form
        method="POST"
        action="?/deleteCampus"
        use:enhance={() => {
          return async ({ result, update }) => {
            update();
            if (result.type === 'success') {
              showDeleteConfirm = false;
              deletingCampusId = '';
            } else if (result.type === 'failure') {
              console.error('Failed to delete campus:', result.data?.message);
            } else if (result.type === 'error') {
              console.error('Error deleting campus:', result.error?.message);
            }
          };
        }}
      >
        <input type="hidden" name="universityId" value={data.university.id} />
        <input type="hidden" name="campusId" value={deletingCampusId} />
        <button type="submit" class="btn btn-error">
          {m.delete()}
        </button>
      </form>
    </div>
  </div>
</dialog>

<!-- Invite Link Modal -->
<InviteLinkModal
  bind:isOpen={showInviteModal}
  type="university"
  targetId={data.university.id}
  targetName={data.university.name}
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
