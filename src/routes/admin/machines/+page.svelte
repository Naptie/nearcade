<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { PageData, ActionData } from './$types';
  import { adaptiveNewTab, pageTitle } from '$lib/utils';
  import { enhance } from '$app/forms';
  import type { Shop, Machine } from '$lib/types';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { fromPath } from '$lib/utils/scoped';

  type MachineOwner = {
    id: string;
    name: string;
    displayName?: string | null;
    image?: string | null;
  };

  type MachineRow = Machine & {
    shop?: Shop;
    owner?: MachineOwner | null;
  };

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let searchQuery = $derived(data.search || '');
  let searchTimeout: ReturnType<typeof setTimeout>;

  let copied = $state<string | null>(null);

  // Modal states
  let showCreateModal = $state(false);
  let showEditModal = $state(false);
  let showDeleteModal = $state(false);
  let showUserSearchModal = $state(false);
  let showShopSearchModal = $state(false);
  let selectedMachine = $state<MachineRow | null>(null);

  // Form states - each modal has its own error state to avoid cross-modal persistence
  const defaultCreateForm = {
    name: '',
    shopId: '',
    shopDisplay: '',
    ownerId: '',
    ownerDisplay: ''
  };
  let createForm = $state({ ...defaultCreateForm });
  let createError = $state('');

  let editForm = $state({ name: '' });
  let editError = $state('');

  let deleteError = $state('');

  let isSubmitting = $state(false);

  // User search state
  let userSearchQuery = $state('');
  let userSearchResults = $state<
    {
      id: string;
      name: string;
      displayName?: string | null;
      email?: string;
      image?: string | null;
    }[]
  >([]);
  let isSearchingUsers = $state(false);
  let userSearchTimeout: ReturnType<typeof setTimeout>;

  // Shop search state
  let shopSearchQuery = $state('');
  let shopSearchResults = $state<{ id: number; name: string }[]>([]);
  let isSearchingShops = $state(false);
  let shopSearchTimeout: ReturnType<typeof setTimeout>;

  const handleSearchInput = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      updateSearch();
    }, 300);
  };

  const updateSearch = () => {
    const url = new URL(page.url);
    if (searchQuery.trim()) {
      url.searchParams.set('search', searchQuery.trim());
    } else {
      url.searchParams.delete('search');
    }
    url.searchParams.delete('page');
    goto(url.toString());
  };

  const openCreateModal = () => {
    createForm = { ...defaultCreateForm };
    createError = '';
    showCreateModal = true;
  };

  const closeCreateModal = () => {
    showCreateModal = false;
    createForm = { ...defaultCreateForm };
    createError = '';
  };

  const openEditModal = (machine: MachineRow) => {
    selectedMachine = machine;
    editForm.name = machine.name;
    editError = '';
    showEditModal = true;
  };

  const closeEditModal = () => {
    showEditModal = false;
    selectedMachine = null;
    editError = '';
  };

  const openDeleteModal = (machine: MachineRow) => {
    selectedMachine = machine;
    deleteError = '';
    showDeleteModal = true;
  };

  const closeDeleteModal = () => {
    showDeleteModal = false;
    selectedMachine = null;
    deleteError = '';
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    copied = text;
    setTimeout(() => {
      if (copied === text) {
        copied = null;
      }
    }, 2000);
  };

  // User search
  const handleUserSearchInput = () => {
    clearTimeout(userSearchTimeout);
    userSearchTimeout = setTimeout(() => {
      searchUsers();
    }, 300);
  };

  const searchUsers = async () => {
    if (!userSearchQuery.trim()) {
      userSearchResults = [];
      return;
    }
    isSearchingUsers = true;
    try {
      const response = await fetch(
        fromPath('/api/admin/users/search') + `?q=${encodeURIComponent(userSearchQuery.trim())}`
      );
      if (response.ok) {
        const data = (await response.json()) as { users: typeof userSearchResults };
        userSearchResults = data.users;
      }
    } catch {
      userSearchResults = [];
    } finally {
      isSearchingUsers = false;
    }
  };

  const selectOwner = (user: { id: string; name: string; displayName?: string | null }) => {
    createForm.ownerId = user.id;
    createForm.ownerDisplay = user.displayName || user.name || user.id;
    showUserSearchModal = false;
    userSearchQuery = '';
    userSearchResults = [];
  };

  const clearOwner = () => {
    createForm.ownerId = '';
    createForm.ownerDisplay = '';
  };

  const closeUserSearchModal = () => {
    showUserSearchModal = false;
    userSearchQuery = '';
    userSearchResults = [];
  };

  // Shop search
  const handleShopSearchInput = () => {
    clearTimeout(shopSearchTimeout);
    shopSearchTimeout = setTimeout(() => {
      searchShops();
    }, 300);
  };

  const searchShops = async () => {
    if (!shopSearchQuery.trim()) {
      shopSearchResults = [];
      return;
    }
    isSearchingShops = true;
    try {
      const response = await fetch(
        fromPath('/api/admin/shops/search') + `?q=${encodeURIComponent(shopSearchQuery.trim())}`
      );
      if (response.ok) {
        const data = (await response.json()) as { shops: typeof shopSearchResults };
        shopSearchResults = data.shops;
      }
    } catch {
      shopSearchResults = [];
    } finally {
      isSearchingShops = false;
    }
  };

  const selectShop = (shop: { id: number; name: string }) => {
    createForm.shopId = String(shop.id);
    createForm.shopDisplay = `#${shop.id} ${shop.name}`;
    showShopSearchModal = false;
    shopSearchQuery = '';
    shopSearchResults = [];
  };

  const clearShop = () => {
    createForm.shopId = '';
    createForm.shopDisplay = '';
  };

  const closeShopSearchModal = () => {
    showShopSearchModal = false;
    shopSearchQuery = '';
    shopSearchResults = [];
  };
</script>

<svelte:head>
  <title>{pageTitle(m.admin_machines(), m.admin_panel())}</title>
</svelte:head>

<div class="min-w-3xs space-y-6">
  <!-- Page Header -->
  <div class="flex flex-col items-center justify-between gap-4 sm:flex-row">
    <div class="not-sm:text-center">
      <h1 class="text-base-content text-3xl font-bold">{m.admin_machines()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_machines_description()}</p>
    </div>

    <div class="flex items-center gap-4">
      <!-- Machine Statistics -->
      <div class="stats shadow">
        <div class="stat px-4 py-2">
          <div class="stat-title text-xs">{m.total()}</div>
          <div class="stat-value text-primary text-xl">{data.machineStats?.total || 0}</div>
        </div>
        <div class="stat px-4 py-2">
          <div class="stat-title text-xs">{m.activated()}</div>
          <div class="stat-value text-success text-xl">{data.machineStats?.activated || 0}</div>
        </div>
      </div>

      <!-- Create Button -->
      <button class="btn btn-primary" onclick={openCreateModal}>
        <i class="fa-solid fa-plus"></i>
        {m.create_machine()}
      </button>
    </div>
  </div>

  <!-- Search -->
  <div class="bg-base-100 border-base-300 rounded-lg border p-4 shadow-sm">
    <div class="form-control">
      <label class="label" for="search">
        <span class="label-text font-medium">{m.search()}</span>
      </label>
      <input
        id="search"
        type="text"
        class="input input-bordered w-full"
        placeholder={m.admin_search_by_name_or_serial()}
        bind:value={searchQuery}
        oninput={handleSearchInput}
      />
    </div>
  </div>

  <!-- Machines List -->
  <div class="bg-base-100 border-base-300 rounded-lg border shadow-sm">
    {#if data.machines && data.machines.length > 0}
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr>
              <th>{m.name()}</th>
              <th>{m.serial_number()}</th>
              <th class="not-sm:hidden">{m.bound_shop()}</th>
              <th class="not-lg:hidden">{m.machine_owner()}</th>
              <th class="not-sm:hidden">{m.status()}</th>
              <th class="text-right">{m.admin_actions_header()}</th>
            </tr>
          </thead>
          <tbody>
            {#each data.machines as machine (machine._id)}
              <tr class="hover">
                <td>
                  <div class="font-medium">{machine.name}</div>
                </td>
                <td>
                  <div class="flex items-center gap-2">
                    <code class="text-sm">
                      {(machine.serialNumber ?? '').match(/.{1,4}/g)?.join('-') ||
                        machine.serialNumber}
                    </code>
                    <button
                      class="btn btn-sm btn-circle btn-soft hover:bg-primary hover:text-primary-content dark:hover:bg-white dark:hover:text-black"
                      class:btn-success={copied === machine.serialNumber}
                      class:btn-active={copied === machine.serialNumber}
                      onclick={() => copyToClipboard(machine.serialNumber)}
                      title={m.copy()}
                    >
                      {#if copied === machine.serialNumber}
                        <i class="fa-solid fa-check fa-lg"></i>
                      {:else}
                        <i class="fa-solid fa-copy fa-lg"></i>
                      {/if}
                    </button>
                  </div>
                </td>
                <td class="not-sm:hidden">
                  {#if machine.shop}
                    <a
                      href={resolve('/(main)/shops/[id]', {
                        id: machine.shopId.toString()
                      })}
                      target={adaptiveNewTab()}
                      class="link link-hover"
                    >
                      {machine.shop.name}
                    </a>
                  {:else}
                    <span class="opacity-60">#{machine.shopId}</span>
                  {/if}
                </td>
                <td class="not-lg:hidden">
                  {#if machine.owner}
                    <UserAvatar user={machine.owner} size="sm" showName target={adaptiveNewTab()} />
                  {:else if machine.ownerId}
                    <code class="text-xs opacity-80">{machine.ownerId}</code>
                  {:else}
                    <span class="opacity-40">—</span>
                  {/if}
                </td>
                <td class="not-sm:hidden">
                  {#if machine.isActivated}
                    <span class="badge badge-success badge-soft">
                      <i class="fa-solid fa-check-circle"></i>
                      {m.activated()}
                    </span>
                  {:else}
                    <span class="badge badge-warning badge-soft">
                      <i class="fa-solid fa-clock"></i>
                      {m.pending_activation()}
                    </span>
                  {/if}
                </td>
                <td>
                  <div class="flex justify-end gap-2">
                    <button
                      class="btn btn-soft btn-sm"
                      onclick={() => openEditModal(machine)}
                      title={m.edit()}
                    >
                      <i class="fa-solid fa-pen"></i>
                    </button>
                    <button
                      class="btn btn-error btn-soft btn-sm"
                      onclick={() => openDeleteModal(machine)}
                      title={m.delete()}
                    >
                      <i class="fa-solid fa-trash"></i>
                    </button>
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
                : ''}"
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
                : ''}"
              class="btn btn-soft"
            >
              {m.next_page()}
            </a>
          {/if}
        </div>
      </div>
    {:else}
      <div class="py-12 text-center">
        <i class="fa-solid fa-server text-base-content/40 mb-4 text-4xl"></i>
        <h3 class="text-base-content mb-2 text-lg font-semibold">{m.no_machines_found()}</h3>
        <p class="text-base-content/60">
          {data.search ? m.no_machines_found_search() : m.no_machines_found_empty()}
        </p>
        {#if !data.search}
          <button class="btn btn-primary mt-4" onclick={openCreateModal}>
            <i class="fa-solid fa-plus"></i>
            {m.create_machine()}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Create Machine Modal -->
<div class="modal" class:modal-open={showCreateModal}>
  <div class="modal-box">
    <h3 class="mb-4 text-lg font-bold">{m.create_machine()}</h3>

    <form
      method="POST"
      action="?/create"
      use:enhance={() => {
        isSubmitting = true;
        createError = '';
        return async ({ result, update }) => {
          isSubmitting = false;
          if (result.type === 'success') {
            closeCreateModal();
            await invalidateAll();
          } else {
            await update();
            if (form?.error) createError = form.error;
          }
        };
      }}
    >
      <div class="space-y-4">
        <div class="form-control">
          <label class="label" for="create-name">
            <span class="label-text">{m.machine_name()}</span>
          </label>
          <input
            id="create-name"
            name="name"
            type="text"
            class="input input-bordered w-full"
            placeholder={m.machine_name_placeholder()}
            bind:value={createForm.name}
            required
          />
        </div>

        <div class="form-control">
          <label class="label" for="create-shop-id">
            <span class="label-text">{m.bound_shop()}</span>
          </label>
          <input type="hidden" name="shopId" value={createForm.shopId} />
          <div class="flex gap-2">
            <input
              id="create-shop-id"
              type="text"
              class="input input-bordered flex-1"
              placeholder={m.shop_id_placeholder()}
              value={createForm.shopDisplay}
              readonly
            />
            {#if createForm.shopId}
              <button
                type="button"
                class="btn btn-ghost btn-sm self-center"
                onclick={clearShop}
                title={m.delete()}
              >
                <i class="fa-solid fa-xmark"></i>
              </button>
            {/if}
            <button
              type="button"
              class="btn btn-soft self-center"
              onclick={() => (showShopSearchModal = true)}
            >
              <i class="fa-solid fa-magnifying-glass"></i>
              {m.search_shop()}
            </button>
          </div>
        </div>

        <div class="form-control">
          <label class="label" for="create-owner">
            <span class="label-text">{m.machine_owner()}</span>
          </label>
          <input type="hidden" name="ownerId" value={createForm.ownerId} />
          <div class="flex gap-2">
            <input
              id="create-owner"
              type="text"
              class="input input-bordered flex-1"
              placeholder={m.no_owner()}
              value={createForm.ownerDisplay}
              readonly
            />
            {#if createForm.ownerId}
              <button
                type="button"
                class="btn btn-ghost btn-sm self-center"
                onclick={clearOwner}
                title={m.delete()}
              >
                <i class="fa-solid fa-xmark"></i>
              </button>
            {/if}
            <button
              type="button"
              class="btn btn-soft self-center"
              onclick={() => (showUserSearchModal = true)}
            >
              <i class="fa-solid fa-magnifying-glass"></i>
              {m.search_user()}
            </button>
          </div>
        </div>

        {#if createError}
          <div class="alert alert-error">
            <i class="fa-solid fa-exclamation-circle"></i>
            <span>{createError}</span>
          </div>
        {/if}
      </div>

      <div class="modal-action">
        <button
          type="button"
          class="btn btn-ghost"
          onclick={closeCreateModal}
          disabled={isSubmitting}
        >
          {m.cancel()}
        </button>
        <button type="submit" class="btn btn-primary" disabled={isSubmitting || !createForm.shopId}>
          {#if isSubmitting}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          {m.create()}
        </button>
      </div>
    </form>
  </div>
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    onclick={closeCreateModal}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') closeCreateModal();
    }}
  ></div>
</div>

<!-- User Search Modal -->
<div class="modal" class:modal-open={showUserSearchModal}>
  <div class="modal-box">
    <h3 class="mb-4 text-lg font-bold">{m.search_user()}</h3>

    <div class="form-control mb-4">
      <input
        type="text"
        class="input input-bordered w-full"
        placeholder={m.search_user_placeholder()}
        bind:value={userSearchQuery}
        oninput={handleUserSearchInput}
      />
    </div>

    <div class="min-h-16 space-y-2">
      {#if isSearchingUsers}
        <div class="flex justify-center py-4">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
      {:else if userSearchResults.length > 0}
        {#each userSearchResults as user (user.id)}
          <button
            type="button"
            class="btn btn-ghost w-full justify-start gap-3 text-left"
            onclick={() => selectOwner(user)}
          >
            <div class="avatar placeholder shrink-0">
              <div class="bg-neutral text-neutral-content w-8 rounded-full">
                {#if user.image}
                  <img src={user.image} alt={user.displayName || user.name} />
                {:else}
                  <span class="text-xs"
                    >{(user.displayName || user.name || '?')[0].toUpperCase()}</span
                  >
                {/if}
              </div>
            </div>
            <div class="min-w-0">
              <div class="truncate font-medium">{user.displayName || user.name}</div>
              <div class="truncate text-xs opacity-60">@{user.name} · {user.id}</div>
            </div>
          </button>
        {/each}
      {:else if userSearchQuery.trim()}
        <p class="text-base-content/60 py-4 text-center text-sm">
          {m.admin_no_users_search_results()}
        </p>
      {:else}
        <p class="text-base-content/60 py-4 text-center text-sm">{m.search_user_placeholder()}</p>
      {/if}
    </div>

    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={closeUserSearchModal}>
        {m.cancel()}
      </button>
    </div>
  </div>
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    onclick={closeUserSearchModal}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') closeUserSearchModal();
    }}
  ></div>
</div>

<!-- Shop Search Modal -->
<div class="modal" class:modal-open={showShopSearchModal}>
  <div class="modal-box">
    <h3 class="mb-4 text-lg font-bold">{m.search_shop()}</h3>

    <div class="form-control mb-4">
      <input
        type="text"
        class="input input-bordered w-full"
        placeholder={m.search_shop_placeholder()}
        bind:value={shopSearchQuery}
        oninput={handleShopSearchInput}
      />
    </div>

    <div class="min-h-16 space-y-2">
      {#if isSearchingShops}
        <div class="flex justify-center py-4">
          <span class="loading loading-spinner loading-sm"></span>
        </div>
      {:else if shopSearchResults.length > 0}
        {#each shopSearchResults as shop (shop.id)}
          <button
            type="button"
            class="btn btn-ghost w-full justify-start gap-3 text-left"
            onclick={() => selectShop(shop)}
          >
            <div class="bg-base-200 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
              <i class="fa-solid fa-store text-xs"></i>
            </div>
            <div class="min-w-0">
              <div class="truncate font-medium">{shop.name}</div>
              <div class="truncate text-xs opacity-60">#{shop.id}</div>
            </div>
          </button>
        {/each}
      {:else if shopSearchQuery.trim()}
        <p class="text-base-content/60 py-4 text-center text-sm">
          {m.no_shops_found_for({ query: shopSearchQuery.trim() })}
        </p>
      {:else}
        <p class="text-base-content/60 py-4 text-center text-sm">
          {m.search_shop_placeholder()}
        </p>
      {/if}
    </div>

    <div class="modal-action">
      <button type="button" class="btn btn-ghost" onclick={closeShopSearchModal}>
        {m.cancel()}
      </button>
    </div>
  </div>
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    onclick={closeShopSearchModal}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') closeShopSearchModal();
    }}
  ></div>
</div>

<!-- Edit Machine Modal -->
{#if showEditModal && selectedMachine}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="mb-4 text-lg font-bold">{m.edit_machine()}</h3>

      <form
        method="POST"
        action="?/update"
        use:enhance={() => {
          isSubmitting = true;
          editError = '';
          return async ({ result, update }) => {
            isSubmitting = false;
            if (result.type === 'success') {
              closeEditModal();
              await invalidateAll();
            } else {
              await update();
              if (form?.error) editError = form.error;
            }
          };
        }}
      >
        <input type="hidden" name="machineId" value={selectedMachine.id} />

        <div class="space-y-4">
          <div class="form-control">
            <label class="label" for="edit-name">
              <span class="label-text">{m.machine_name()}</span>
            </label>
            <input
              id="edit-name"
              name="name"
              type="text"
              class="input input-bordered w-full"
              bind:value={editForm.name}
              required
            />
          </div>

          <div class="bg-base-200 rounded-lg p-4">
            <div class="text-sm">
              <div class="flex justify-between py-1">
                <span class="opacity-60">{m.serial_number()}</span>
                <code>
                  {(selectedMachine.serialNumber ?? '').match(/.{1,4}/g)?.join('-') ||
                    selectedMachine.serialNumber}
                </code>
              </div>
              <div class="flex justify-between py-1">
                <span class="opacity-60">{m.bound_shop()}</span>
                <span>{selectedMachine.shop?.name || `#${selectedMachine.shopId}`}</span>
              </div>
              <div class="flex justify-between py-1">
                <span class="opacity-60">{m.status()}</span>
                <span>{selectedMachine.isActivated ? m.activated() : m.pending_activation()}</span>
              </div>
            </div>
          </div>

          {#if editError}
            <div class="alert alert-error">
              <i class="fa-solid fa-exclamation-circle"></i>
              <span>{editError}</span>
            </div>
          {/if}
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={closeEditModal}
            disabled={isSubmitting}
          >
            {m.cancel()}
          </button>
          <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
            {#if isSubmitting}
              <span class="loading loading-spinner loading-xs"></span>
            {/if}
            {m.save()}
          </button>
        </div>
      </form>
    </div>
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={closeEditModal}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') closeEditModal();
      }}
    ></div>
  </div>
{/if}

<!-- Delete Confirmation Modal -->
{#if showDeleteModal && selectedMachine}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="mb-4 text-lg font-bold">{m.delete_machine()}</h3>

      <p class="text-base-content/70 mb-4">
        {m.confirm_delete_machine({ name: selectedMachine.name })}
      </p>

      {#if selectedMachine.isActivated}
        <div class="alert alert-warning mb-4">
          <i class="fa-solid fa-exclamation-triangle"></i>
          <span>{m.delete_activated_machine_warning()}</span>
        </div>
      {/if}

      <form
        method="POST"
        action="?/delete"
        use:enhance={() => {
          isSubmitting = true;
          deleteError = '';
          return async ({ result, update }) => {
            isSubmitting = false;
            if (result.type === 'success') {
              closeDeleteModal();
              await invalidateAll();
            } else {
              await update();
              if (form?.error) deleteError = form.error;
            }
          };
        }}
      >
        <input type="hidden" name="machineId" value={selectedMachine.id} />

        {#if deleteError}
          <div class="alert alert-error mb-4">
            <i class="fa-solid fa-exclamation-circle"></i>
            <span>{deleteError}</span>
          </div>
        {/if}

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={closeDeleteModal}
            disabled={isSubmitting}
          >
            {m.cancel()}
          </button>
          <button type="submit" class="btn btn-error" disabled={isSubmitting}>
            {#if isSubmitting}
              <span class="loading loading-spinner loading-xs"></span>
            {/if}
            {m.delete()}
          </button>
        </div>
      </form>
    </div>
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      onclick={closeDeleteModal}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') closeDeleteModal();
      }}
    ></div>
  </div>
{/if}
