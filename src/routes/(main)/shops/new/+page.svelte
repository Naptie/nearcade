<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { pageTitle } from '$lib/utils';
  import ShopForm, { type ShopFormData } from '$lib/components/ShopForm.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const initialData: Partial<ShopFormData> = $derived.by(() => {
    if (data.initialLat !== null && data.initialLng !== null) {
      return {
        location: {
          type: 'Point' as const,
          coordinates: [data.initialLng, data.initialLat] as [number, number]
        }
      };
    }
    return {};
  });

  let successMessage = $state('');

  async function handleSubmit(formData: ShopFormData) {
    const response = await fetch('/api/shops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error ?? 'Failed to create shop');
    }

    const { shop } = await response.json();
    successMessage = m.shop_created_successfully();
    await goto(resolve('/(main)/shops/[id]', { id: String(shop.id) }));
  }
</script>

<svelte:head>
  <title>{pageTitle(m.create_shop())}</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 pt-20 pb-12 sm:px-6 lg:px-8">
  <div class="mb-8">
    <h1 class="text-3xl font-bold">{m.create_shop()}</h1>
  </div>

  {#if successMessage}
    <div class="alert alert-success mb-6">
      <i class="fa-solid fa-circle-check"></i>
      <span>{successMessage}</span>
    </div>
  {/if}

  <ShopForm
    {initialData}
    onSubmit={handleSubmit}
    onCancel={() => goto(resolve('/(main)/shops'))}
    submitLabel={m.create_shop()}
  />
</div>
