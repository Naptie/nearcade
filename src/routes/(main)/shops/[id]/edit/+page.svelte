<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { getVerifiedContactStatus } from '$lib/auth/verified-contact';
  import VerifiedContactPrompt from '$lib/components/VerifiedContactPrompt.svelte';
  import { pageTitle } from '$lib/utils';
  import ShopForm from '$lib/components/ShopForm.svelte';
  import type { ShopFormData } from '$lib/schemas/forms';
  import type { PageData } from './$types';
  import PhotoCarousel from '$lib/components/PhotoCarousel.svelte';

  let { data }: { data: PageData } = $props();

  const shop = $derived(data.shop);
  const verifiedContactStatus = $derived(getVerifiedContactStatus(data.user));
  const canManageShop = $derived(!!data.user && verifiedContactStatus.eligible);

  const initialData: Partial<ShopFormData> = $derived.by(() => ({
    name: shop.name,
    comment: shop.comment,
    address: shop.address,
    openingHours: shop.openingHours,
    location: shop.location,
    games: shop.games.map((g) => ({
      titleId: g.titleId,
      name: g.name,
      version: g.version,
      comment: g.comment,
      cost: g.cost,
      quantity: g.quantity
    }))
  }));

  let successMessage = $state('');

  async function handleSubmit(formData: ShopFormData) {
    if (!canManageShop) return;

    const response = await fetch(`/api/shops/${shop.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message ?? body?.error ?? 'Failed to update shop');
    }

    successMessage = m.shop_updated_successfully();
    await goto(resolve('/(main)/shops/[id]', { id: String(shop.id) }));
  }
</script>

<svelte:head>
  <title>{pageTitle(m.edit_shop(), shop.name)}</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 pt-20 pb-12 sm:px-6 lg:px-8">
  <div class="mb-8">
    <h1 class="text-3xl font-bold">{m.edit_shop()}</h1>
    <p class="text-base-content/60">{shop.name}</p>
  </div>

  {#if successMessage}
    <div class="alert alert-success mb-6">
      <i class="fa-solid fa-circle-check"></i>
      <span>{successMessage}</span>
    </div>
  {/if}

  {#if canManageShop}
    <ShopForm
      {initialData}
      onSubmit={handleSubmit}
      onCancel={() => goto(resolve('/(main)/shops/[id]', { id: String(shop.id) }))}
      submitLabel={m.save_changes()}
    />
  {:else}
    <VerifiedContactPrompt
      user={data.user}
      loginMessage={m.sign_in()}
      icon="fa-pen-to-square"
      class="bg-base-100 border-base-300 border shadow-sm"
    />
  {/if}

  <!-- Photos section -->
  <div class="bg-base-100 border-base-content/20 mt-8 rounded-2xl border p-6 shadow-sm">
    <PhotoCarousel
      shopId={shop.id}
      bind:photos={data.photos}
      currentUser={data.user}
      canUpload={canManageShop}
      canManagePhotos={canManageShop}
      disabledActionReason={!data.user
        ? ''
        : !verifiedContactStatus.hasVerifiedEmail && !verifiedContactStatus.hasPhone
          ? m.verified_contact_required_for_contribution()
          : !verifiedContactStatus.hasVerifiedEmail
            ? m.verified_email_required_for_contribution()
            : m.phone_binding_required_for_contribution()}
    />
  </div>
</div>
