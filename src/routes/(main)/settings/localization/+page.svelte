<script lang="ts">
  import { enhance } from '$app/forms';
  import { SvelteSet } from 'svelte/reactivity';
  import { m } from '$lib/paraglide/messages';
  import { getLocale, locales } from '$lib/paraglide/runtime';
  import { toast } from '$lib/notifications/toast.svelte';
  import { resolveStatusMessage } from '$lib/notifications/messages';
  import { unsavedChanges } from '$lib/actions/unsaved-changes';
  import { dismissBanner } from '$lib/notifications/banner.svelte';
  import { pageTitle } from '$lib/utils';
  import {
    UGC_CONTENT_TYPES,
    UGC_TRANSLATION_GROUPS,
    type UgcTranslationGroupId,
    type UgcTranslationField
  } from '$lib/ugc/types';
  import { UGC_TRANSLATION_ENABLED } from '$lib/constants';
  import type { PageData } from './$types';
  import { page } from '$app/state';

  let { data }: { data: PageData } = $props();

  const BANNER_ID = 'settings-translation-unsaved';

  let isSubmitting = $state(false);

  // Local edits override the server-provided values; they are dropped when
  // fresh data arrives (e.g. after saving), mirroring the profile settings.
  let selectedLocaleOverride = $state<string | null>(null);
  let selectedFieldsOverride: SvelteSet<UgcTranslationField> | null = $state(null);

  let selectedLocale = $derived(selectedLocaleOverride ?? data.locale ?? getLocale());
  let selectedFields = $derived(
    selectedFieldsOverride ?? new SvelteSet(data.autoTranslation?.fields ?? [])
  );

  const toggleGroup = (groupId: UgcTranslationGroupId) => {
    const group = UGC_TRANSLATION_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    const next = new SvelteSet(selectedFields);
    const allOn = group.types.every((type) => selectedFields.has(type));
    for (const type of group.types) {
      if (allOn) {
        next.delete(type);
      } else {
        next.add(type);
      }
    }
    selectedFieldsOverride = next;
  };

  const groupSelected = (groupId: UgcTranslationGroupId): boolean => {
    const group = UGC_TRANSLATION_GROUPS.find((g) => g.id === groupId);
    return group ? group.types.every((type) => selectedFields.has(type)) : false;
  };

  const allSelected = $derived(UGC_CONTENT_TYPES.every((type) => selectedFields.has(type)));

  const toggleAll = () => {
    selectedFieldsOverride = allSelected ? new SvelteSet() : new SvelteSet(UGC_CONTENT_TYPES);
  };

  const GROUP_LABELS: Record<
    UgcTranslationGroupId,
    { label: () => string; description: () => string }
  > = {
    shop_name: {
      label: () => m.ugc_group_shop_name(),
      description: () => m.ugc_group_shop_name_description()
    },
    shop_address: {
      label: () => m.ugc_group_shop_address(),
      description: () => m.ugc_group_shop_address_description()
    },
    game_name: {
      label: () => m.ugc_group_game_name(),
      description: () => m.ugc_group_game_name_description()
    },
    game_version: {
      label: () => m.ugc_group_game_version(),
      description: () => m.ugc_group_game_version_description()
    },
    description: {
      label: () => m.ugc_group_description(),
      description: () => m.ugc_group_description_description()
    },
    posts: {
      label: () => m.ugc_group_posts(),
      description: () => m.ugc_group_posts_description()
    },
    comments: {
      label: () => m.ugc_group_comments(),
      description: () => m.ugc_group_comments_description()
    },
    others: {
      label: () => m.ugc_group_others(),
      description: () => m.ugc_group_others_description()
    }
  };

  $effect(() => {
    if (page.url.searchParams.get('success') === 'true') {
      toast(m.localization_settings_updated(), { type: 'success' });
    }
  });
</script>

<svelte:head>
  <title>{pageTitle(m.localization_settings())}</title>
</svelte:head>

<div class="space-y-6 md:space-y-10 md:p-5">
  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold md:text-3xl">{m.localization_settings()}</h1>
    <p class="text-base-content/70 mt-1">{m.localization_settings_description()}</p>
  </div>

  <form
    method="POST"
    action="?/updateTranslation"
    use:enhance={() => {
      isSubmitting = true;
      return async ({ result }) => {
        isSubmitting = false;
        if (result.type === 'success' && result.data?.success) {
          dismissBanner(BANNER_ID);
          location.href = '?success=true';
        } else if (result.type === 'failure' && result.data) {
          const rawMessage = (result.data as { message?: string }).message;
          if (rawMessage) {
            toast(resolveStatusMessage(rawMessage) ?? rawMessage, { type: 'error' });
          }
        }
      };
    }}
    use:unsavedChanges={{ id: BANNER_ID }}
    class="bg-base-100 space-y-6 rounded-lg p-6"
  >
    <h3 class="text-lg font-semibold">{m.localization_settings()}</h3>

    <!-- Interface language -->
    <div class="form-control">
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 class="text-base-content font-medium">{m.interface_language()}</h3>
          <p class="text-base-content/60 mt-1 text-sm">{m.interface_language_description()}</p>
        </div>
      </div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {#each locales as localeOption (localeOption)}
          <label
            class="hover:border-primary flex cursor-pointer items-center gap-3 rounded-lg border-2 border-current/10 p-3 transition-colors"
            class:border-primary={selectedLocale === localeOption}
          >
            <input
              type="radio"
              name="locale"
              value={localeOption}
              class="radio radio-primary radio-sm"
              checked={selectedLocale === localeOption}
              onchange={() => (selectedLocaleOverride = localeOption)}
            />
            <span class="text-base-content text-sm"
              >{m.locale_name(undefined, { locale: localeOption })}</span
            >
          </label>
        {/each}
      </div>
    </div>

    {#if UGC_TRANSLATION_ENABLED}
      <div class="divider">{m.auto_localization_settings()}</div>

      <div class="form-control">
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-base-content font-medium">{m.auto_localization_settings()}</h3>
            <p class="text-base-content/60 mt-1 text-sm">{m.auto_translation_description()}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={toggleAll}>
            <i class="fa-solid {allSelected ? 'fa-square-minus' : 'fa-square-check'}"></i>
            <span class="hidden sm:inline">
              {allSelected ? m.deselect_all() : m.select_all()}
            </span>
          </button>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          {#each UGC_TRANSLATION_GROUPS as group (group.id)}
            <label
              class="border-base-300 hover:border-primary flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition-colors"
              class:border-primary={groupSelected(group.id)}
            >
              <input
                type="checkbox"
                name="ugcGroup_{group.id}"
                class="checkbox hover:checkbox-primary checked:checkbox-primary mt-0.5 transition"
                checked={groupSelected(group.id)}
                onchange={() => toggleGroup(group.id)}
              />
              <span>
                <span class="text-base-content text-sm font-medium">
                  {GROUP_LABELS[group.id].label()}
                </span>
                <span class="text-base-content/60 block text-xs">
                  {GROUP_LABELS[group.id].description()}
                </span>
              </span>
            </label>
          {/each}
        </div>
      </div>
    {/if}

    <div class="flex justify-end">
      <button type="submit" class="btn btn-primary" disabled={isSubmitting}>
        {#if isSubmitting}
          <span class="loading loading-spinner loading-sm"></span>
        {/if}
        {m.save_changes()}
      </button>
    </div>
  </form>
</div>
