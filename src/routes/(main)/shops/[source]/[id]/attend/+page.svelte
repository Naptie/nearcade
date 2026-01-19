<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import { pageTitle } from '$lib/utils';
  import { resolve } from '$app/paths';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head>
  <title>{pageTitle(m.attend_registration(), m.shop_details())}</title>
</svelte:head>

<div class="mx-auto max-w-lg px-4 pt-20 pb-8">
  <div class="card bg-base-200 shadow-xl">
    <div class="card-body text-center">
      {#if data.status === 'success'}
        <!-- Success State -->
        <div class="text-success mb-4">
          <i class="fa-solid fa-circle-check text-6xl"></i>
        </div>
        <h1 class="text-2xl font-bold">{m.attend_registration_success()}</h1>
        <p class="text-base-content/70 mt-2">
          {m.attend_registration_success_description()}
        </p>

        {#if data.shop}
          <div class="bg-base-100 mt-6 rounded-lg p-4">
            <div class="text-sm">
              <div class="flex justify-between py-2">
                <span class="opacity-60">{m.shop()}</span>
                <span class="font-medium">{data.shop.name}</span>
              </div>
              <div class="flex justify-between py-2">
                <span class="opacity-60">{m.slot_index()}</span>
                <span class="font-mono font-medium">{data.slotIndex}</span>
              </div>
            </div>
          </div>
        {/if}
      {:else}
        <!-- Error State -->
        <div class="text-error mb-4">
          <i class="fa-solid fa-circle-xmark text-6xl"></i>
        </div>
        <h1 class="text-2xl font-bold">{m.attend_registration_failed()}</h1>

        {#if data.errorCode === 'expired_or_invalid'}
          <p class="text-base-content/70 mt-2">
            {m.attend_registration_expired_or_invalid()}
          </p>
        {:else if data.errorCode === 'invalid_shop'}
          <p class="text-base-content/70 mt-2">
            {m.attend_registration_invalid_shop()}
          </p>
        {:else if data.errorCode === 'already_registered'}
          <p class="text-base-content/70 mt-2">
            {m.attend_registration_already_registered()}
          </p>
          {#if data.slotIndex}
            <div class="bg-base-100 mt-4 rounded-lg p-4">
              <div class="text-sm">
                <div class="flex justify-between py-2">
                  <span class="opacity-60">{m.slot_index()}</span>
                  <span class="font-mono font-medium">{data.slotIndex}</span>
                </div>
              </div>
            </div>
          {/if}
        {:else}
          <p class="text-base-content/70 mt-2">
            {m.unexpected_error()}
          </p>
        {/if}
      {/if}

      <div class="mt-6 flex items-center justify-center gap-2">
        {#if data.shop}
          <a
            href={resolve('/(main)/shops/[source]/[id]', {
              source: data.shop.source,
              id: data.shop.id.toString()
            })}
            class="btn btn-primary"
          >
            <i class="fa-solid fa-store"></i>
            {m.shop_details()}
          </a>
        {/if}
        <a href={resolve('/')} class="btn btn-secondary btn-soft">
          <i class="fa-solid fa-home"></i>
          {m.go_home()}
        </a>
      </div>
    </div>
  </div>
</div>
