<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { hasBoundPhone } from '$lib/utils';
  import { toast } from '$lib/notifications/toast.svelte';
  import { phoneRequiredToast } from '$lib/notifications/phone-required';
  import { showBanner, dismissBanner } from '$lib/notifications/banner.svelte';
  import VerifiedContactPrompt from '$lib/components/VerifiedContactPrompt.svelte';
  import { pageTitle } from '$lib/utils';
  import ShopForm from '$lib/components/ShopForm.svelte';
  import {
    clearShopDraft,
    draftToInitialData,
    readShopDraft,
    scheduleShopDraftSave,
    SHOP_DRAFT_STORAGE_KEY,
    type ShopCreateDraft
  } from '$lib/actions/shop-draft';
  import type { ShopFormData } from '$lib/schemas/forms';
  import type { PageData } from './$types';
  import type { ShopPhoto } from '$lib/types';
  import PhotoCarousel from '$lib/components/PhotoCarousel.svelte';

  const DRAFT_STORAGE_KEY = SHOP_DRAFT_STORAGE_KEY;

  let { data }: { data: PageData } = $props();

  const hasPhone = $derived(hasBoundPhone(data.user) || data.user?.userType === 'site_admin');
  const canManageShop = $derived(!!data.user && hasPhone);

  const baseInitialData: Partial<ShopFormData> = $derived.by(() => {
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

  // Draft restore state. When the user chooses to restore, we swap in the saved
  // draft and re-mount ShopForm (via the `formVersion` key) so its local state
  // re-initializes from the restored data.
  let restoredDraft = $state<ShopCreateDraft | null>(null);
  let draftBannerDismissed = $state(false);
  let formVersion = $state(0);

  const savedDraft = $derived(readShopDraft(DRAFT_STORAGE_KEY));
  const pendingDraft = $derived(savedDraft && !draftBannerDismissed ? savedDraft : null);

  $effect(() => {
    const draft = pendingDraft;
    if (!draft || !data.user || createdShopId !== null) {
      dismissBanner('shop-create-draft-restore');
      return;
    }

    showBanner({
      id: 'shop-create-draft-restore',
      title: m.shop_create_draft_title(),
      message: m.shop_create_draft_message(),
      type: 'warning',
      icon: 'fa-file-pen',
      onDismiss: () => {
        // Runs when the banner is closed via the X button. The Restore action
        // also passes through here first, but its onClick re-persists below.
        clearShopDraft(DRAFT_STORAGE_KEY);
        draftBannerDismissed = true;
        restoredDraft = null;
      },
      action: {
        label: m.restore(),
        onClick: () => {
          // Grab the freshest read in case another tab modified it. `onDismiss`
          // already cleared storage, so fall back to the captured value and
          // re-persist it so the restored form remains a draft until submit.
          const current = readShopDraft(DRAFT_STORAGE_KEY) ?? draft;
          restoredDraft = current;
          scheduleShopDraftSave(current, DRAFT_STORAGE_KEY);
          draftBannerDismissed = true;
          formVersion += 1;
        }
      }
    });

    return () => dismissBanner('shop-create-draft-restore');
  });

  const initialData = $derived.by<Partial<ShopFormData>>(() => {
    if (restoredDraft) {
      return draftToInitialData(restoredDraft);
    }
    return baseInitialData;
  });

  const initialLocationName = $derived(restoredDraft?.locationName ?? '');

  let createdShopId = $state<number | null>(null);
  let createdShopPhotos = $state<ShopPhoto[]>([]);

  async function handleSubmit(formData: ShopFormData) {
    if (!data.user) {
      window.dispatchEvent(new CustomEvent('nearcade-login'));
      return;
    }
    if (!canManageShop) {
      phoneRequiredToast();
      return;
    }

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
    toast(m.shop_created_successfully(), { type: 'success' });
    createdShopId = shop.id;
  }
</script>

<svelte:head>
  <title>{pageTitle(m.create_shop())}</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 pt-20 pb-12 sm:px-6 lg:px-8">
  <div class="mb-8">
    <h1 class="text-3xl font-bold">{m.create_shop()}</h1>
  </div>

  {#if createdShopId === null}
    {#if data.user}
      {#key formVersion}
        <ShopForm
          {initialData}
          {initialLocationName}
          onSubmit={handleSubmit}
          onCancel={() => goto(resolve('/(main)/shops'))}
          submitLabel={m.create_shop()}
          draftStorageKey={DRAFT_STORAGE_KEY}
          onFirstEdit={() => {
            // The user is working on a fresh form; stop offering to restore the
            // old draft so "Restore" can't clobber their in-progress typing.
            draftBannerDismissed = true;
          }}
        />
      {/key}
    {:else}
      <VerifiedContactPrompt
        user={data.user}
        loginMessage={m.sign_in()}
        icon="fa-store"
        class="bg-base-100 border-base-300 border shadow-sm"
      />
    {/if}
  {:else}
    <!-- Shop created: let user upload photos before navigating -->
    <div class="bg-base-100 border-base-300 mb-6 rounded-2xl border p-6 shadow-sm">
      <PhotoCarousel
        shopId={createdShopId}
        bind:photos={createdShopPhotos}
        currentUser={canManageShop ? data.user : undefined}
      />
    </div>
    <div class="flex gap-3">
      <button
        class="btn btn-primary flex-1"
        onclick={() => goto(resolve('/(main)/shops/[id]', { id: String(createdShopId) }))}
      >
        <i class="fa-solid fa-store"></i>
        {m.view_shop()}
      </button>
    </div>
  {/if}
</div>
