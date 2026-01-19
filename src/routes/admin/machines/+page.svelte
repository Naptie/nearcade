<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { page } from '$app/state';
  import { goto, invalidateAll } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { PageData, ActionData } from './$types';
  import { adaptiveNewTab, pageTitle } from '$lib/utils';
  import { enhance } from '$app/forms';
  import type { Shop, Machine } from '$lib/types';
  import { ShopSource } from '$lib/constants';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let searchQuery = $state(data.search || '');
  let searchTimeout: ReturnType<typeof setTimeout>;

  // Modal states
  let showCreateModal = $state(false);
  let showEditModal = $state(false);
  let showDeleteModal = $state(false);
  let selectedMachine = $state<(Machine & { shop?: Shop }) | null>(null);

  // Form states
  let createForm = $state({
    name: '',
    shopSource: ShopSource.BEMANICN as string,
    shopId: ''
  });
  let editForm = $state({ name: '' });

  let isSubmitting = $state(false);

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

  const openEditModal = (machine: Machine & { shop?: Shop }) => {
    selectedMachine = machine;
    editForm.name = machine.name;
    showEditModal = true;
  };

  const openDeleteModal = (machine: Machine & { shop?: Shop }) => {
    selectedMachine = machine;
    showDeleteModal = true;
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
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
      <button class="btn btn-primary" onclick={() => (showCreateModal = true)}>
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
                    <code class="text-sm">{machine.serialNumber}</code>
                    <button
                      class="btn btn-ghost btn-xs"
                      onclick={() => copyToClipboard(machine.serialNumber)}
                      title={m.copy()}
                    >
                      <i class="fa-solid fa-copy"></i>
                    </button>
                  </div>
                </td>
                <td class="not-sm:hidden">
                  {#if machine.shop}
                    <a
                      href={resolve('/(main)/shops/[source]/[id]', {
                        source: machine.shopSource,
                        id: machine.shopId.toString()
                      })}
                      target={adaptiveNewTab()}
                      class="link link-hover"
                    >
                      {machine.shop.name}
                    </a>
                  {:else}
                    <span class="opacity-60"
                      >{machine.shopSource.toUpperCase()} #{machine.shopId}</span
                    >
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
          <button class="btn btn-primary mt-4" onclick={() => (showCreateModal = true)}>
            <i class="fa-solid fa-plus"></i>
            {m.create_machine()}
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- Create Machine Modal -->
{#if showCreateModal}
  <div class="modal modal-open">
    <div class="modal-box">
      <h3 class="mb-4 text-lg font-bold">{m.create_machine()}</h3>

      <form
        method="POST"
        action="?/create"
        use:enhance={() => {
          isSubmitting = true;
          return async ({ result, update }) => {
            isSubmitting = false;
            if (result.type === 'success') {
              showCreateModal = false;
              createForm = { name: '', shopSource: ShopSource.BEMANICN, shopId: '' };
              await invalidateAll();
            } else {
              await update();
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
            <label class="label" for="create-shop-source">
              <span class="label-text">{m.shop_source()}</span>
            </label>
            <select
              id="create-shop-source"
              name="shopSource"
              class="select select-bordered w-full"
              bind:value={createForm.shopSource}
              required
            >
              {#each Object.values(ShopSource) as source (source)}
                <option value={source}>{source.toUpperCase()}</option>
              {/each}
            </select>
          </div>

          <div class="form-control">
            <label class="label" for="create-shop-id">
              <span class="label-text">{m.shop_id()}</span>
            </label>
            <input
              id="create-shop-id"
              name="shopId"
              type="number"
              class="input input-bordered w-full"
              placeholder={m.shop_id_placeholder()}
              bind:value={createForm.shopId}
              required
            />
          </div>

          {#if form?.error}
            <div class="alert alert-error">
              <i class="fa-solid fa-exclamation-circle"></i>
              <span>{form.error}</span>
            </div>
          {/if}
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => (showCreateModal = false)}
            disabled={isSubmitting}
          >
            {m.cancel()}
          </button>
          <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
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
      onclick={() => (showCreateModal = false)}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') showCreateModal = false;
      }}
    ></div>
  </div>
{/if}

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
          return async ({ result, update }) => {
            isSubmitting = false;
            if (result.type === 'success') {
              showEditModal = false;
              selectedMachine = null;
              await invalidateAll();
            } else {
              await update();
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
                <code>{selectedMachine.serialNumber}</code>
              </div>
              <div class="flex justify-between py-1">
                <span class="opacity-60">{m.bound_shop()}</span>
                <span
                  >{selectedMachine.shop?.name ||
                    `${selectedMachine.shopSource.toUpperCase()} #${selectedMachine.shopId}`}</span
                >
              </div>
              <div class="flex justify-between py-1">
                <span class="opacity-60">{m.status()}</span>
                <span>{selectedMachine.isActivated ? m.activated() : m.pending_activation()}</span>
              </div>
            </div>
          </div>

          {#if form?.error}
            <div class="alert alert-error">
              <i class="fa-solid fa-exclamation-circle"></i>
              <span>{form.error}</span>
            </div>
          {/if}
        </div>

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => (showEditModal = false)}
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
      onclick={() => (showEditModal = false)}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') showEditModal = false;
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
          return async ({ result, update }) => {
            isSubmitting = false;
            if (result.type === 'success') {
              showDeleteModal = false;
              selectedMachine = null;
              await invalidateAll();
            } else {
              await update();
            }
          };
        }}
      >
        <input type="hidden" name="machineId" value={selectedMachine.id} />

        {#if form?.error}
          <div class="alert alert-error mb-4">
            <i class="fa-solid fa-exclamation-circle"></i>
            <span>{form.error}</span>
          </div>
        {/if}

        <div class="modal-action">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => (showDeleteModal = false)}
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
      onclick={() => (showDeleteModal = false)}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') showDeleteModal = false;
      }}
    ></div>
  </div>
{/if}
