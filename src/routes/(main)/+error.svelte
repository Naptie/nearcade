<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { GITHUB_LINK } from '$lib';
  import Footer from '$lib/components/Footer.svelte';
  import { m } from '$lib/paraglide/messages';

  let status = $derived(page.status);
  let errorMessage = $derived(page.error?.message || '');

  const getErrorContent = (status: number) => {
    switch (status) {
      case 404:
        return {
          title: m.error_404_title(),
          description: m.error_404_description(),
          icon: 'fas fa-map-location-dot',
          color: 'text-info'
        };
      case 500:
        return {
          title: m.error_500_title(),
          description: m.error_500_description(),
          icon: 'fas fa-server',
          color: 'text-error'
        };
      case 400:
        return {
          title: m.error_400_title(),
          description: m.error_400_description(),
          icon: 'fas fa-exclamation-triangle',
          color: 'text-warning'
        };
      default:
        return {
          title: m.error_unknown_title(),
          description: m.error_unknown_description(),
          icon: 'fas fa-question-circle',
          color: 'text-base-content'
        };
    }
  };

  let errorContent = $derived(getErrorContent(status));

  const goHome = () => {
    goto('/');
  };

  const tryAgain = () => {
    window.location.reload();
  };

  const reportIssue = () => {
    const issueUrl = `${GITHUB_LINK}/issues/new?title=Error%20${status}&body=Error%20Message:%20${encodeURIComponent(errorMessage)}%0A%0APage:%20${encodeURIComponent(window.location.href)}`;
    window.open(issueUrl, '_blank');
  };
</script>

<svelte:head>
  <title>{errorContent.title} - nearcade</title>
</svelte:head>

<div class="container mx-auto flex min-h-screen items-center justify-center py-20 sm:px-4">
  <div class="w-full max-w-md">
    <!-- Error Card -->
    <div class="card bg-base-100 border-base-300 border shadow-sm transition hover:shadow-xl">
      <div class="card-body text-center">
        <!-- Error Icon -->
        <div class="mb-6">
          <i class="{errorContent.icon} text-6xl {errorContent.color}"></i>
        </div>

        <!-- Error Status -->
        <div class="mb-4">
          <div class="text-base-content mb-2 text-4xl font-bold">{status}</div>
          <h1 class="text-base-content mb-2 text-xl font-semibold">
            {errorContent.title}
          </h1>
          <p class="text-base-content/70 text-sm">
            {errorContent.description}
          </p>
        </div>

        <!-- Error Message (if available) -->
        {#if errorMessage}
          <div class="alert alert-soft alert-error mb-4 text-left">
            <i class="fas fa-exclamation-circle text-sm"></i>
            <span class="font-mono">{errorMessage}</span>
          </div>
        {/if}

        <!-- Action Buttons -->
        <div class="flex flex-col gap-2">
          <button class="btn btn-primary" onclick={goHome}>
            <i class="fas fa-home"></i>
            {m.go_home()}
          </button>

          <div class="flex gap-2">
            <button class="btn btn-outline btn-secondary flex-1" onclick={tryAgain}>
              <i class="fas fa-refresh"></i>
              {m.try_again()}
            </button>

            <button class="btn btn-outline btn-ghost flex-1" onclick={reportIssue}>
              <i class="fas fa-bug"></i>
              {m.report_issue()}
            </button>
          </div>
        </div>
      </div>
    </div>
    <Footer />
  </div>
</div>

<style>
  /* Add some subtle animations */
  .card {
    animation: fadeInUp 0.5s ease-out;
  }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
