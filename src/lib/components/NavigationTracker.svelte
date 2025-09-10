<script lang="ts">
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import DonationModal from './DonationModal.svelte';

  // Configuration constants
  const STORAGE_KEY = 'nearcade-navigation-count';
  const DISMISS_KEY = 'nearcade-donate-dismissed-until';
  const INITIAL_THRESHOLD = 20;
  const RECURRING_INTERVAL = 50;

  // State
  let visitCount = $state(0);
  let showDonationModal = $state(false);

  // Helper functions
  const getStoredCount = (): number => {
    if (!browser) return 0;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored, 10) : 0;
  };

  const setStoredCount = (count: number): void => {
    if (!browser) return;
    localStorage.setItem(STORAGE_KEY, count.toString());
  };

  const getDismissedUntil = (): number => {
    if (!browser) return 0;
    const stored = localStorage.getItem(DISMISS_KEY);
    return stored ? parseInt(stored, 10) : 0;
  };
  const setDismissedUntil = (timestamp: number): void => {
    if (!browser) return;
    localStorage.setItem(DISMISS_KEY, timestamp.toString());
  };

  const shouldShowModal = (count: number): boolean => {
    const dismissedUntil = getDismissedUntil();
    if (Date.now() < dismissedUntil) {
      return false;
    }

    if (count === 1 || count === INITIAL_THRESHOLD) return true;
    if (count > INITIAL_THRESHOLD && count % RECURRING_INTERVAL === 0) return true;

    return false;
  };

  const incrementVisitCount = (): void => {
    const newCount = visitCount + 1;
    visitCount = newCount;
    setStoredCount(newCount);
    console.log(`Visit count incremented to ${newCount}`);

    if (shouldShowModal(newCount)) {
      showDonationModal = true;
    }
  };

  const closeDonationModal = (): void => {
    showDonationModal = false;
  };

  const openDonationModal = (): void => {
    showDonationModal = true;
  };

  const dismiss = (days: number): void => {
    const dismissUntil = Date.now() + days * 24 * 60 * 60 * 1000;
    setDismissedUntil(dismissUntil);
    showDonationModal = false;
  };

  onMount(() => {
    visitCount = getStoredCount();

    window.addEventListener('nearcade-donate', openDonationModal);

    return () => {
      window.removeEventListener('nearcade-donate', openDonationModal);
    };
  });

  // Track SPA navigation
  afterNavigate(() => {
    incrementVisitCount();
  });
</script>

<!-- Only render modal if we have a visit count and it should be shown -->
{#if visitCount > 0}
  <DonationModal
    isOpen={showDonationModal}
    {visitCount}
    onClose={closeDonationModal}
    onDismiss={dismiss}
  />
{/if}
