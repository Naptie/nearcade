<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { m } from '$lib/paraglide/messages';

  interface Props {
    /** Query-param holding the inclusive lower bound. Defaults to `from`. */
    fromParam?: string;
    /** Query-param holding the inclusive upper bound. Defaults to `to`. */
    toParam?: string;
    /** Localized label for the lower bound. */
    fromLabel?: string;
    /** Localized label for the upper bound. */
    toLabel?: string;
  }

  // Destructured without `let` so these are a one-time snapshot: the query-param
  // names and labels are fixed for the component's lifetime, and seeding the
  // inputs from the URL must not re-run when the URL changes.
  const { fromParam = 'from', toParam = 'to', fromLabel, toLabel }: Props = $props();

  const uid = $props.id();

  /** Normalize a stored bound to the `YYYY-MM-DD` shape a date input expects. */
  const toInputValue = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // Accept both a bare date and a full ISO timestamp.
    return trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
  };

  // Seeded empty; the reconcile effect below fills them from the URL on mount, so
  // there is only one code path that copies URL state into the inputs.
  let from = $state('');
  let to = $state('');
  let pending = $state(false);

  const commit = () => {
    const url = new URL(page.url);

    if (from) url.searchParams.set(fromParam, from);
    else url.searchParams.delete(fromParam);

    if (to) url.searchParams.set(toParam, to);
    else url.searchParams.delete(toParam);

    url.searchParams.delete('page');

    const next = `${url.pathname}${url.search}${url.hash}`;
    const current = `${page.url.pathname}${page.url.search}${page.url.hash}`;
    if (next !== current) {
      goto(next, { replaceState: true, keepFocus: true, noScroll: true });
    }
  };

  const handleChange = () => {
    pending = true;
    commit();
  };

  const clear = () => {
    pending = true;
    from = '';
    to = '';
    commit();
  };

  // Track external URL changes (deep links, back/forward) without fighting
  // an in-progress local edit.
  $effect(() => {
    const urlFrom = toInputValue(page.url.searchParams.get(fromParam) ?? '');
    const urlTo = toInputValue(page.url.searchParams.get(toParam) ?? '');

    if (urlFrom === from && urlTo === to) {
      pending = false;
      return;
    }
    if (pending) return;

    if (urlFrom !== from) from = urlFrom;
    if (urlTo !== to) to = urlTo;
  });

  const hasRange = $derived(Boolean(from || to));
</script>

<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
  <div class="flex flex-wrap items-end gap-3">
    <div class="form-control">
      <label class="label" for="admin-date-from-{uid}">
        <span class="label-text font-medium">{fromLabel ?? m.from()}</span>
      </label>
      <input
        id="admin-date-from-{uid}"
        type="date"
        class="input input-bordered"
        max={to || undefined}
        bind:value={from}
        onchange={handleChange}
      />
    </div>

    <div class="form-control">
      <label class="label" for="admin-date-to-{uid}">
        <span class="label-text font-medium">{toLabel ?? m.to()}</span>
      </label>
      <input
        id="admin-date-to-{uid}"
        type="date"
        class="input input-bordered"
        min={from || undefined}
        bind:value={to}
        onchange={handleChange}
      />
    </div>
  </div>

  {#if hasRange}
    <button type="button" class="btn btn-ghost btn-sm" onclick={clear}>
      <i class="fa-solid fa-xmark"></i>
      {m.admin_clear_filters()}
    </button>
  {/if}
</div>
