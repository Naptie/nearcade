<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import {
    adaptiveNewTab,
    formatDate,
    formatDateTime,
    getDisplayName,
    getUserTypeBadgeClass,
    getUserTypeLabel,
    pageTitle
  } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import type { User } from '$lib/auth/types';
  import type { Club, ClubMember, University, UniversityMember } from '$lib/types';
  import UserAvatar from '$lib/components/UserAvatar.svelte';

  let { data }: { data: PageData } = $props();

  // Client-side search/filter state
  let searchQuery = $state('');
  let selectedUserType = $state('all');
  let currentPage = $state(1);
  let hasMore = $state(false);
  let users = $state<
    Array<
      User & {
        universitiesCount: number;
        clubsCount: number;
      }
    >
  >([]);
  let isLoadingUsers = $state(false);
  let copiedId = $state<string | null>(null);
  let searchTimeout: ReturnType<typeof setTimeout>;

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      copiedId = id;
      setTimeout(() => {
        if (copiedId === id) {
          copiedId = null;
        }
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Fetch users from the API
  const fetchUsers = async () => {
    isLoadingUsers = true;
    try {
      const parts = [`detailed=true`, `limit=20`, `page=${currentPage}`];
      if (searchQuery.trim()) {
        parts.push(`q=${encodeURIComponent(searchQuery.trim())}`);
      }
      if (selectedUserType && selectedUserType !== 'all') {
        parts.push(`userType=${encodeURIComponent(selectedUserType)}`);
      }
      const response = await fetch(fromPath('/api/admin/users/search') + `?${parts.join('&')}`);
      if (response.ok) {
        const result = await response.json();
        users = result.users;
        hasMore = result.hasMore;
        currentPage = result.currentPage;
      }
    } catch {
      users = [];
      hasMore = false;
    } finally {
      isLoadingUsers = false;
    }
  };

  // Load users on mount
  onMount(() => {
    fetchUsers();
  });

  const handleSearchInput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentPage = 1;
      fetchUsers();
    }, 300);
  };

  const handleUserTypeChange = () => {
    currentPage = 1;
    fetchUsers();
  };

  const goToPage = (page: number) => {
    currentPage = page;
    fetchUsers();
  };

  // Modal state for user type editing
  let editingUser: { id?: string; name?: string | null; userType?: string } | null = $state(null);
  let userDetails: {
    user?: User;
    universityMemberships?: (UniversityMember & { university?: University })[];
    clubMemberships?: (ClubMember & { club?: Club })[];
  } | null = $state(null);
  let loadingUserDetails = $state(false);
  let newUserType = $state('');
  let selectedOrganization = $state<{ id: string; name: string } | null>(null);
  let organizationQuery = $state('');
  let organizationResults = $state<Array<{ id: string; name: string; slug?: string }>>([]);
  let isSearchingOrganizations = $state(false);
  let organizationSearchTimeout: ReturnType<typeof setTimeout>;
  let selectedOrganizationType = $state('university');
  let selectedMemberType = $state('');
  let isSubmitting = $state(false);
  let submittingVerificationEmailId = $state<string | null>(null);
  let verificationEmailFeedback = $state<{
    membershipId: string;
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const memberTypeLabels = {
    member: m.admin_member_type_member(),
    student: m.admin_member_type_student(),
    moderator: m.admin_member_type_moderator(),
    admin: m.admin_member_type_admin()
  };

  const openEditModal = async (user: {
    id?: string;
    name?: string | null;
    displayName?: string | null;
    userType?: string;
  }) => {
    if (editingUser) return;
    editingUser = {
      id: user.id,
      name: getDisplayName(user),
      userType: user.userType
    };
    newUserType = user.userType || 'regular';

    // Fetch user details with memberships
    await fetchUserDetails(user.id);
  };

  const fetchUserDetails = async (userId?: string) => {
    if (!userId) return;

    loadingUserDetails = true;
    try {
      const response = await fetch(fromPath(`/api/admin/users/${userId}`));
      if (response.ok) {
        userDetails = await response.json();
      } else {
        console.error('Failed to fetch user details');
        userDetails = null;
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      userDetails = null;
    } finally {
      loadingUserDetails = false;
    }
  };

  const closeEditModal = () => {
    newUserType = '';
    setTimeout(() => {
      editingUser = null;
      userDetails = null;
      loadingUserDetails = false;
      selectedOrganization = null;
      organizationQuery = '';
      organizationResults = [];
      selectedOrganizationType = 'university';
      selectedMemberType = '';
      verificationEmailFeedback = null;
    }, 300);
  };

  const searchOrganizations = async (query: string) => {
    if (!query.trim()) {
      organizationResults = [];
      return;
    }
    isSearchingOrganizations = true;
    try {
      const response = await fetch(
        fromPath('/api/admin/organizations/search') +
          `?type=${encodeURIComponent(selectedOrganizationType)}&q=${encodeURIComponent(query.trim())}`
      );
      if (response.ok) {
        const result = await response.json();
        organizationResults = result.organizations || [];
      } else {
        organizationResults = [];
      }
    } catch {
      organizationResults = [];
    } finally {
      isSearchingOrganizations = false;
    }
  };

  const handleOrganizationQueryInput = () => {
    if (organizationQuery !== selectedOrganization?.name) {
      selectedOrganization = null;
    }
    clearTimeout(organizationSearchTimeout);
    organizationSearchTimeout = setTimeout(() => {
      searchOrganizations(organizationQuery);
    }, 300);
  };

  const selectOrganization = (org: { id: string; name: string }) => {
    selectedOrganization = { id: org.id, name: org.name };
    organizationQuery = org.name;
    organizationResults = [];
    const existing = getExistingMembership(selectedOrganizationType, org.id);
    selectedMemberType = existing?.memberType || '';
  };

  const getExistingMembership = (organizationType: string, organizationId?: string | null) => {
    if (!userDetails || !organizationId) return null;

    if (organizationType === 'university') {
      return (
        userDetails.universityMemberships?.find((m) => m.universityId === organizationId) || null
      );
    } else if (organizationType === 'club') {
      return userDetails.clubMemberships?.find((m) => m.clubId === organizationId) || null;
    }
    return null;
  };
</script>

<svelte:head>
  <title>{pageTitle(m.admin_users(), m.admin_panel())}</title>
</svelte:head>

<div class="space-y-6">
  <!-- Page Header -->
  <div class="flex flex-col items-center justify-between gap-4 lg:flex-row">
    <div class="not-lg:text-center">
      <h1 class="text-base-content text-3xl font-bold">{m.admin_users()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_users_description()}</p>
    </div>

    <!-- User Type Statistics -->
    <div class="flex gap-4 not-md:flex-wrap">
      {#each Object.entries(data.userTypeStats || {}) as [type, count], index (index)}
        <div class="stat bg-base-100 min-w-0 rounded-lg shadow-sm">
          <div class="stat-title text-xs">{getUserTypeLabel(type)}</div>
          <div class="stat-value text-lg">{count}</div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Filters -->
  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <div class="flex flex-col gap-4 sm:flex-row">
      <div class="form-control flex-1">
        <label class="label" for="search">
          <span class="label-text font-medium">{m.search()}</span>
        </label>
        <input
          id="search"
          type="text"
          class="input input-bordered w-full"
          placeholder={m.admin_search_by_name_email()}
          bind:value={searchQuery}
          oninput={handleSearchInput}
        />
      </div>

      <div class="form-control">
        <label class="label" for="userType">
          <span class="label-text font-medium">{m.user_type()}</span>
        </label>
        <select
          id="userType"
          class="select select-bordered"
          bind:value={selectedUserType}
          onchange={handleUserTypeChange}
        >
          {#each ['all', 'site_admin', 'developer', 'school_admin', 'school_moderator', 'club_admin', 'club_moderator', 'student', 'regular'] as option (option)}
            <option value={option}>
              {option === 'all' ? m.admin_all_types() : getUserTypeLabel(option)}
            </option>
          {/each}
        </select>
      </div>
    </div>
  </div>

  <!-- Users List -->
  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if isLoadingUsers}
      <div class="py-12 text-center">
        <span class="loading loading-spinner loading-lg"></span>
        <p class="text-base-content/60 mt-2">{m.loading()}</p>
      </div>
    {:else if users && users.length > 0}
      <div class="overflow-x-auto">
        <table class="table w-full table-fixed">
          <thead>
            <tr>
              <th class="w-[40%] sm:w-auto">{m.admin_user_header()}</th>
              <th class="not-ss:hidden">{m.admin_type_header()}</th>
              <th class="w-[40%] sm:w-auto">{m.admin_associations_header()}</th>
              <th class="not-sm:hidden">{m.admin_last_active_header()}</th>
              <th class="not-md:hidden">{m.admin_joined_header()}</th>
              <th class="w-[20%] text-right sm:w-auto">{m.admin_actions_header()}</th>
            </tr>
          </thead>
          <tbody>
            {#each users as user (user.id)}
              <tr class="hover">
                <td class="max-w-[35vw]">
                  <div
                    class="group flex cursor-pointer items-center gap-3"
                    title={user.email && !user.email.endsWith('.nearcade')
                      ? `Email: ${user.email}`
                      : undefined}
                  >
                    <UserAvatar {user} size="md" target={adaptiveNewTab()} />
                    <a
                      href={resolve('/(main)/users/[id]', { id: '@' + user.name })}
                      target={adaptiveNewTab()}
                      class="group-hover:text-accent min-w-0 flex-1 transition-colors"
                    >
                      <div class="truncate font-medium">
                        {getDisplayName(user)}
                      </div>
                      <div class="truncate text-sm opacity-60">
                        <code class="font-mono">{user.id}</code>
                      </div>
                    </a>
                    <button
                      type="button"
                      class="btn btn-sm btn-circle btn-soft hover:bg-primary hover:text-primary-content dark:hover:bg-white dark:hover:text-black"
                      class:btn-success={copiedId === user.id}
                      class:btn-active={copiedId === user.id}
                      onclick={() => copyId(user.id)}
                      title={m.copy()}
                      aria-label={m.copy()}
                    >
                      {#if copiedId === user.id}
                        <i class="fa-solid fa-check fa-sm"></i>
                      {:else}
                        <i class="fa-solid fa-copy fa-sm"></i>
                      {/if}
                    </button>
                  </div>
                </td>
                <td class="not-ss:hidden">
                  <div class="badge badge-sm text-nowrap {getUserTypeBadgeClass(user.userType)}">
                    {getUserTypeLabel(user.userType)}
                  </div>
                </td>
                <td>
                  <div class="text-sm text-nowrap">
                    <div>{m.admin_universities_count({ count: user.universitiesCount || 0 })}</div>
                    <div>{m.admin_clubs_count({ count: user.clubsCount || 0 })}</div>
                  </div>
                </td>
                <td class="not-sm:hidden">
                  {#if user.lastActiveAt}
                    <div class="truncate text-sm lg:hidden">
                      {formatDate(user.lastActiveAt)}
                    </div>
                    <div class="truncate text-sm not-lg:hidden">
                      {formatDateTime(user.lastActiveAt)}
                    </div>
                  {/if}
                </td>
                <td class="not-md:hidden">
                  {#if user.joinedAt}
                    <div class="truncate text-sm xl:hidden">
                      {formatDate(user.joinedAt)}
                    </div>
                    <div class="truncate text-sm not-xl:hidden">
                      {formatDateTime(user.joinedAt)}
                    </div>
                  {/if}
                </td>
                <td>
                  <div class="flex flex-col items-end gap-1 sm:flex-row sm:justify-end sm:gap-2">
                    <button
                      class="btn btn-primary btn-soft btn-xs sm:btn-sm min-h-[36px] text-nowrap sm:min-h-[44px] sm:min-w-[44px]"
                      onclick={() => openEditModal(user)}
                    >
                      <i class="fa-solid fa-edit"></i>
                      <span class="not-lg:hidden">{m.edit()}</span>
                    </button>

                    <form
                      method="POST"
                      action="?/deleteUser"
                      use:enhance={() => {
                        return async ({ result, update }) => {
                          if (result.type === 'success') {
                            await invalidateAll();
                            await fetchUsers();
                          }
                          await update();
                        };
                      }}
                      class="contents"
                    >
                      <input type="hidden" name="userId" value={user.id} />
                      <button
                        type="button"
                        class="btn btn-error btn-soft btn-xs sm:btn-sm min-h-[36px] text-nowrap sm:min-h-[44px] sm:min-w-[44px]"
                        onclick={(e) =>
                          confirm(m.admin_user_delete_confirm()) &&
                          e.currentTarget.closest('form')?.requestSubmit()}
                        disabled={user.id === data.user?.id}
                      >
                        <i class="fa-solid fa-trash"></i>
                        <span class="not-lg:hidden">{m.delete()}</span>
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="border-base-300 border-t p-4">
        <div class="flex justify-center gap-2">
          {#if currentPage > 1}
            <button class="btn btn-soft" onclick={() => goToPage(currentPage - 1)}>
              {m.previous_page()}
            </button>
          {/if}
          <span class="btn btn-disabled btn-soft">
            {m.page({ page: currentPage })}
          </span>
          {#if hasMore}
            <button class="btn btn-soft" onclick={() => goToPage(currentPage + 1)}>
              {m.next_page()}
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="py-12 text-center">
        <i class="fa-solid fa-user text-base-content/40 mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">{m.admin_no_users_found()}</h3>
        <p class="text-base-content/60">
          {searchQuery.trim() ? m.admin_no_users_search_results() : m.admin_no_users_available()}
        </p>
      </div>
    {/if}
  </div>
</div>

<!-- Edit User Modal -->
<div class="modal" class:modal-open={newUserType}>
  <div class="modal-box max-w-3xl">
    <h3 class="mb-4 text-lg font-bold">{m.admin_edit_user()}</h3>
    {#if editingUser}
      <div class="space-y-4">
        <div>
          <div class="label">
            <span class="label-text font-medium">{m.user()}</span>
          </div>
          <div class="text-base-content/80">{editingUser.name}</div>
        </div>
        {#if userDetails?.user?.userType !== 'site_admin'}
          <div class="bg-base-200 rounded-lg p-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div class="text-sm font-medium">{m.developer()}</div>
                <p class="text-base-content/60 text-sm">{m.admin_developer_access_description()}</p>
              </div>
              <form
                method="POST"
                action="?/setDeveloperAccess"
                use:enhance={() => {
                  isSubmitting = true;
                  return async ({ result, update }) => {
                    isSubmitting = false;
                    if (result.type === 'success') {
                      await update();
                      await invalidateAll();
                      await fetchUserDetails(editingUser?.id);
                      await fetchUsers();
                    }
                  };
                }}
              >
                <input type="hidden" name="userId" value={editingUser.id} />
                <input
                  type="hidden"
                  name="grant"
                  value={userDetails?.user?.userType === 'developer' ? 'false' : 'true'}
                />
                <button
                  type="submit"
                  class="btn btn-sm {userDetails?.user?.userType === 'developer'
                    ? 'btn-error btn-soft'
                    : 'btn-secondary'}"
                  disabled={isSubmitting}
                >
                  {userDetails?.user?.userType === 'developer'
                    ? m.admin_revoke_developer_access()
                    : m.admin_grant_developer_access()}
                </button>
              </form>
            </div>
          </div>
        {/if}
        <div class="space-y-4">
          <form
            method="POST"
            action="?/updateOrganizationRole"
            use:enhance={({ cancel }) => {
              if (isSubmitting) return cancel(); // Prevent multiple submissions
              isSubmitting = true;
              return async ({ result, update }) => {
                isSubmitting = false;
                if (result.type === 'success') {
                  await invalidateAll();
                  // Refresh user details after successful operation
                  await fetchUserDetails(editingUser?.id);
                  await fetchUsers();
                  // Reset form
                  selectedOrganization = null;
                  organizationQuery = '';
                  organizationResults = [];
                  selectedMemberType = '';
                }
                await update();
              };
            }}
          >
            <input type="hidden" name="userId" value={editingUser.id} />
            <input
              type="hidden"
              name="action"
              value={getExistingMembership(selectedOrganizationType, selectedOrganization?.id)
                ? 'update'
                : 'add'}
            />

            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div class="form-control">
                <label class="label" for="organizationType">
                  <span class="label-text">{m.admin_organization_type()}</span>
                </label>
                <select
                  id="organizationType"
                  name="organizationType"
                  class="select select-bordered w-full"
                  bind:value={selectedOrganizationType}
                  onchange={() => {
                    selectedOrganization = null;
                    organizationQuery = '';
                    organizationResults = [];
                    selectedMemberType = '';
                  }}
                >
                  <option value="university">{m.university()}</option>
                  <option value="club">{m.club()}</option>
                </select>
              </div>

              <div class="form-control relative md:col-span-2">
                <label class="label" for="organizationId">
                  <span class="label-text">
                    {selectedOrganizationType === 'university' ? m.university() : m.club()}
                  </span>
                </label>
                <input
                  id="organizationId"
                  type="text"
                  class="input input-bordered w-full"
                  placeholder={m.admin_search_organization_placeholder()}
                  autocomplete="off"
                  bind:value={organizationQuery}
                  oninput={handleOrganizationQueryInput}
                />
                <input type="hidden" name="organizationId" value={selectedOrganization?.id || ''} />
                {#if organizationQuery.trim() && !selectedOrganization}
                  <div
                    class="border-base-300 bg-base-100 absolute top-full left-0 z-50 mt-1 w-full overflow-hidden rounded-lg border shadow-lg"
                  >
                    {#if isSearchingOrganizations}
                      <div class="px-3 py-2 text-sm opacity-60">
                        <span class="loading loading-spinner loading-xs"></span>
                        {m.loading()}
                      </div>
                    {:else if organizationResults.length > 0}
                      <ul class="max-h-64 overflow-y-auto">
                        {#each organizationResults as org (org.id)}
                          <li>
                            <button
                              type="button"
                              class="hover:bg-base-200 w-full px-3 py-2 text-left"
                              onmousedown={(e) => e.preventDefault()}
                              onclick={() => selectOrganization(org)}
                            >
                              <div class="text-sm font-medium">{org.name}</div>
                              <div class="text-xs break-all opacity-60">{org.slug || org.id}</div>
                            </button>
                          </li>
                        {/each}
                      </ul>
                    {:else}
                      <div class="px-3 py-2 text-sm opacity-60">
                        {m.admin_no_organizations_found()}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>

              <div class="form-control md:col-span-3">
                <label class="label" for="memberType">
                  <span class="label-text">{m.admin_member_type()}</span>
                </label>
                <div class="flex gap-2">
                  <select
                    id="memberType"
                    name="memberType"
                    class="select select-bordered flex-1"
                    bind:value={selectedMemberType}
                  >
                    <option value="">{m.admin_choose_role()}</option>
                    {#if selectedOrganizationType === 'university'}
                      <option value="student">{m.admin_member_type_student()}</option>
                      <option value="moderator">{m.admin_member_type_moderator()}</option>
                      <option value="admin">{m.admin_member_type_admin()}</option>
                    {:else}
                      <option value="member">{m.admin_member_type_member()}</option>
                      <option value="moderator">{m.admin_member_type_moderator()}</option>
                      <option value="admin">{m.admin_member_type_admin()}</option>
                    {/if}
                  </select>
                  <button
                    type="submit"
                    class="btn btn-primary"
                    disabled={isSubmitting || !selectedOrganization || !selectedMemberType}
                  >
                    {#if isSubmitting}
                      <span class="loading loading-spinner loading-sm"></span>
                    {:else}
                      <i
                        class="fa-solid {getExistingMembership(
                          selectedOrganizationType,
                          selectedOrganization?.id
                        )
                          ? 'fa-edit'
                          : 'fa-plus'}"
                      ></i>
                      {getExistingMembership(selectedOrganizationType, selectedOrganization?.id)
                        ? m.admin_update_role()
                        : m.admin_add_role()}
                    {/if}
                  </button>
                </div>
              </div>
            </div>
          </form>

          <!-- Current Organization Roles Display -->
          <div class="divider">{m.admin_current_roles()}</div>

          <div class="space-y-3">
            {#if loadingUserDetails}
              <div class="py-4 text-center">
                <span class="loading loading-spinner loading-md"></span>
                <p class="text-base-content/60 mt-2 text-sm">{m.admin_loading_user_details()}</p>
              </div>
            {:else if userDetails}
              <!-- University Memberships -->
              <div>
                <h4 class="mb-2 text-sm font-medium">{m.admin_university_memberships()}</h4>
                <div class="space-y-2">
                  {#each userDetails.universityMemberships || [] as membership (membership.id)}
                    <div class="bg-base-200 flex items-center justify-between rounded-lg p-3">
                      <div>
                        <div class="text-sm font-medium">
                          {membership.university?.name || m.admin_unknown_organization()}
                        </div>
                        <div class="text-base-content/60 text-xs">
                          {m.admin_role()}: {memberTypeLabels[membership.memberType] ||
                            membership.memberType}
                        </div>
                      </div>
                      <div class="flex gap-2">
                        <button
                          class="btn btn-primary btn-sm btn-soft btn-circle"
                          aria-label={m.admin_edit_role()}
                          onclick={() => {
                            selectedOrganizationType = 'university';
                            selectedOrganization = {
                              id: membership.universityId,
                              name: membership.university?.name || ''
                            };
                            organizationQuery = membership.university?.name || '';
                            organizationResults = [];
                            selectedMemberType = membership.memberType;
                          }}
                        >
                          <i class="fa-solid fa-edit"></i>
                        </button>
                        <form
                          method="POST"
                          action="?/updateOrganizationRole"
                          use:enhance={() => {
                            return async ({ result, update }) => {
                              if (result.type === 'success') {
                                await invalidateAll();
                                await fetchUserDetails(editingUser?.id);
                              }
                              await update();
                            };
                          }}
                          class="inline"
                        >
                          <input type="hidden" name="userId" value={editingUser.id} />
                          <input type="hidden" name="organizationType" value="university" />
                          <input
                            type="hidden"
                            name="organizationId"
                            value={membership.universityId}
                          />
                          <input type="hidden" name="action" value="remove" />
                          <button
                            type="button"
                            class="btn btn-error btn-sm btn-soft btn-circle"
                            onclick={(e) =>
                              confirm(m.admin_remove_role_confirm()) &&
                              e.currentTarget.closest('form')?.requestSubmit()}
                            aria-label={m.admin_remove_role_confirm()}
                          >
                            <i class="fa-solid fa-trash"></i>
                          </button>
                        </form>
                      </div>
                    </div>
                    <div class="bg-base-200 rounded-lg p-3">
                      <form
                        method="POST"
                        action="?/updateVerificationEmail"
                        use:enhance={({ cancel }) => {
                          if (submittingVerificationEmailId) return cancel();
                          submittingVerificationEmailId = membership.id;
                          verificationEmailFeedback = null;
                          return async ({ result, update }) => {
                            submittingVerificationEmailId = null;
                            if (result.type === 'success') {
                              verificationEmailFeedback = {
                                membershipId: membership.id,
                                type: 'success',
                                text: m.admin_verification_email_updated()
                              };
                              await invalidateAll();
                              await fetchUserDetails(editingUser?.id);
                            } else {
                              verificationEmailFeedback = {
                                membershipId: membership.id,
                                type: 'error',
                                text:
                                  (result.type === 'failure' &&
                                    (result.data as { error?: string } | undefined)?.error) ||
                                  m.admin_failed_to_update_verification_email()
                              };
                              await update();
                            }
                          };
                        }}
                      >
                        <input type="hidden" name="userId" value={editingUser.id} />
                        <input type="hidden" name="universityId" value={membership.universityId} />
                        <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
                          <div class="form-control flex-1">
                            <label class="label" for="verificationEmail-{membership.id}">
                              <span class="label-text">{m.admin_verification_email()}</span>
                            </label>
                            <input
                              id="verificationEmail-{membership.id}"
                              type="email"
                              name="verificationEmail"
                              class="input input-bordered input-sm w-full"
                              placeholder={m.admin_verification_email_placeholder()}
                              value={membership.verificationEmail || ''}
                            />
                          </div>
                          {#if membership.verifiedAt}
                            <div
                              class="text-base-content/60 order-1 text-xs sm:order-none sm:w-full"
                            >
                              {m.admin_verified_at({
                                date: formatDateTime(membership.verifiedAt)
                              })}
                            </div>
                          {/if}
                          <button
                            type="submit"
                            class="btn btn-primary btn-sm order-2 sm:order-none"
                            disabled={submittingVerificationEmailId === membership.id}
                          >
                            {#if submittingVerificationEmailId === membership.id}
                              <span class="loading loading-spinner loading-sm"></span>
                            {/if}
                            {m.admin_update_verification_email()}
                          </button>
                        </div>
                        {#if verificationEmailFeedback?.membershipId === membership.id}
                          <div
                            class="mt-2 text-xs {verificationEmailFeedback.type === 'success'
                              ? 'text-success'
                              : 'text-error'}"
                          >
                            {verificationEmailFeedback.text}
                          </div>
                        {/if}
                      </form>
                    </div>
                  {:else}
                    <div class="text-sm text-base-content/60 py-2">
                      {m.admin_no_university_memberships()}
                    </div>
                  {/each}
                </div>
              </div>

              <!-- Club Memberships -->
              <div>
                <h4 class="mb-2 text-sm font-medium">{m.admin_club_memberships()}</h4>
                <div class="space-y-2">
                  {#each userDetails.clubMemberships || [] as membership (membership.id)}
                    <div class="bg-base-200 flex items-center justify-between rounded-lg p-3">
                      <div>
                        <div class="text-sm font-medium">
                          {membership.club?.name || m.admin_unknown_organization()}
                        </div>
                        <div class="text-base-content/60 text-xs">
                          {m.admin_role()}: {memberTypeLabels[membership.memberType] ||
                            membership.memberType}
                        </div>
                      </div>
                      <div class="flex gap-2">
                        <button
                          class="btn btn-primary btn-sm btn-soft btn-circle"
                          aria-label={m.admin_edit_role()}
                          onclick={() => {
                            selectedOrganizationType = 'club';
                            selectedOrganization = {
                              id: membership.clubId,
                              name: membership.club?.name || ''
                            };
                            organizationQuery = membership.club?.name || '';
                            organizationResults = [];
                            selectedMemberType = membership.memberType;
                          }}
                        >
                          <i class="fa-solid fa-edit"></i>
                        </button>
                        <form
                          method="POST"
                          action="?/updateOrganizationRole"
                          use:enhance={() => {
                            return async ({ result, update }) => {
                              if (result.type === 'success') {
                                await invalidateAll();
                                await fetchUserDetails(editingUser?.id);
                              }
                              await update();
                            };
                          }}
                          class="inline"
                        >
                          <input type="hidden" name="userId" value={editingUser.id} />
                          <input type="hidden" name="organizationType" value="club" />
                          <input type="hidden" name="organizationId" value={membership.clubId} />
                          <input type="hidden" name="action" value="remove" />
                          <button
                            type="button"
                            class="btn btn-error btn-sm btn-soft btn-circle"
                            onclick={(e) =>
                              confirm(m.admin_remove_role_confirm()) &&
                              e.currentTarget.closest('form')?.requestSubmit()}
                            aria-label={m.admin_remove_role_confirm()}
                          >
                            <i class="fa-solid fa-trash"></i>
                          </button>
                        </form>
                      </div>
                    </div>
                  {:else}
                    <div class="text-sm text-base-content/60 py-2">
                      {m.admin_no_club_memberships()}
                    </div>
                  {/each}
                </div>
              </div>
            {:else}
              <div class="text-base-content/60 text-sm">
                {m.admin_current_roles_info()}
              </div>
            {/if}
          </div>
        </div>

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={closeEditModal}>
            {m.close()}
          </button>
        </div>
      </div>
    {/if}
  </div>
  <div
    class="modal-backdrop"
    onclick={closeEditModal}
    onkeydown={(e) => e.key === 'Escape' && closeEditModal()}
    role="button"
    tabindex="0"
    aria-label={m.close_modal()}
  ></div>
</div>
