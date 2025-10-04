<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
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
  import type { User } from '@auth/sveltekit';
  import type { Club, ClubMember, University, UniversityMember } from '$lib/types';
  import UserAvatar from '$lib/components/UserAvatar.svelte';

  let { data }: { data: PageData } = $props();

  let searchQuery = $state(data.search || '');
  let selectedUserType = $state(data.userType || 'all');
  let searchTimeout: ReturnType<typeof setTimeout>;

  const handleSearchInput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      updateFilters();
    }, 300);
  };

  const handleUserTypeChange = () => {
    updateFilters();
  };

  const updateFilters = () => {
    const url = new URL(page.url);

    if (searchQuery.trim()) {
      url.searchParams.set('search', searchQuery.trim());
    } else {
      url.searchParams.delete('search');
    }

    if (selectedUserType && selectedUserType !== 'all') {
      url.searchParams.set('userType', selectedUserType);
    } else {
      url.searchParams.delete('userType');
    }

    url.searchParams.delete('page'); // Reset to first page
    goto(url.toString());
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
  let selectedOrganization = $state('');
  let selectedOrganizationType = $state('university');
  let selectedMemberType = $state('');
  let isSubmitting = $state(false);

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
      selectedOrganization = '';
      selectedOrganizationType = 'university';
      selectedMemberType = '';
    }, 300);
  };

  const getExistingMembership = (organizationType: string, organizationId: string) => {
    if (!userDetails) return null;

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
    <div class="flex gap-4">
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
          {#each ['all', 'site_admin', 'school_admin', 'school_moderator', 'club_admin', 'club_moderator', 'student', 'regular'] as option (option)}
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
    {#if data.users && data.users.length > 0}
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{m.admin_user_header()}</th>
              <th class="not-ss:hidden">{m.admin_type_header()}</th>
              <th>{m.admin_associations_header()}</th>
              <th class="not-sm:hidden">{m.admin_last_active_header()}</th>
              <th class="not-md:hidden">{m.admin_joined_header()}</th>
              <th class="text-right">{m.admin_actions_header()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.users as user (user.id)}
              <tr class="hover">
                <td class="max-w-[15vw]">
                  <div class="group flex cursor-pointer items-center gap-3" title="ID: {user.id}">
                    <UserAvatar {user} size="md" target={adaptiveNewTab()} />
                    <a
                      href={resolve('/(main)/users/[id]', { id: '@' + user.name })}
                      target={adaptiveNewTab()}
                      class="group-hover:text-accent w-[calc(100%-2.5rem)] transition-colors"
                    >
                      <div class="truncate font-medium">
                        {getDisplayName(user)}
                      </div>
                      {#if user.email && !user.email.endsWith('.nearcade')}
                        <div class="truncate text-sm opacity-60">
                          {user.email}
                        </div>
                      {/if}
                    </a>
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
                  <div class="flex justify-end gap-2">
                    <button
                      class="btn btn-primary btn-soft btn-sm text-nowrap"
                      onclick={() => openEditModal(user)}
                    >
                      <i class="fa-solid fa-edit"></i>
                      <span class="not-lg:hidden">{m.edit()}</span>
                    </button>

                    <form method="POST" action="?/deleteUser" use:enhance class="inline">
                      <input type="hidden" name="userId" value={user.id} />
                      <button
                        type="button"
                        class="btn btn-error btn-sm btn-soft text-nowrap"
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
          {#if (data.currentPage || 1) > 1}
            <a
              href="?page={(data.currentPage || 1) - 1}{data.search
                ? `&search=${encodeURIComponent(data.search)}`
                : ''}{data.userType && data.userType !== 'all' ? `&userType=${data.userType}` : ''}"
              class="btn btn-soft"
            >
              {m.previous_page()}
            </a>
          {/if}
          <span class="btn btn-disabled btn-soft">
            {m.page({ page: data.currentPage || 1 })}
          </span>
          {#if data.hasMore}
            <a
              href="?page={(data.currentPage || 1) + 1}{data.search
                ? `&search=${encodeURIComponent(data.search)}`
                : ''}{data.userType && data.userType !== 'all' ? `&userType=${data.userType}` : ''}"
              class="btn btn-soft"
            >
              {m.next_page()}
            </a>
          {/if}
        </div>
      </div>
    {:else}
      <div class="py-12 text-center">
        <i class="fa-solid fa-user text-base-content/40 mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">{m.admin_no_users_found()}</h3>
        <p class="text-base-content/60">
          {data.search ? m.admin_no_users_search_results() : m.admin_no_users_available()}
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
                  // Refresh user details after successful operation
                  await fetchUserDetails(editingUser?.id);
                  // Reset form
                  selectedOrganization = '';
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
              value={getExistingMembership(selectedOrganizationType, selectedOrganization)
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
                    selectedOrganization = '';
                    selectedMemberType = '';
                  }}
                >
                  <option value="university">{m.university()}</option>
                  <option value="club">{m.club()}</option>
                </select>
              </div>

              <div class="form-control md:col-span-2">
                <label class="label" for="organizationId">
                  <span class="label-text">
                    {selectedOrganizationType === 'university' ? m.university() : m.club()}
                  </span>
                </label>
                <select
                  id="organizationId"
                  name="organizationId"
                  class="select select-bordered w-full"
                  bind:value={selectedOrganization}
                  onchange={() => {
                    const existing = getExistingMembership(
                      selectedOrganizationType,
                      selectedOrganization
                    );
                    selectedMemberType = existing?.memberType || '';
                  }}
                >
                  <option value="">{m.admin_choose_organization()}</option>
                  {#if selectedOrganizationType === 'university'}
                    {#each data.universities || [] as university (university.id)}
                      <option value={university.id}>{university.name}</option>
                    {/each}
                  {:else}
                    {#each data.clubs || [] as club (club.id)}
                      <option value={club.id}>{club.name}</option>
                    {/each}
                  {/if}
                </select>
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
                          selectedOrganization
                        )
                          ? 'fa-edit'
                          : 'fa-plus'}"
                      ></i>
                      {getExistingMembership(selectedOrganizationType, selectedOrganization)
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
                            selectedOrganization = membership.universityId;
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
                            selectedOrganization = membership.clubId;
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
