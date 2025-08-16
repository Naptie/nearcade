<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { GITHUB_LINK } from '$lib';
  import Footer from '$lib/components/Footer.svelte';
  import { m } from '$lib/paraglide/messages';
  import { pageTitle } from '$lib/utils';

  let { status, errorMessage }: { status: number; errorMessage: string } = $props();

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
      case 403:
        return {
          title: m.error_403_title(),
          description: m.error_403_description(),
          icon: 'fas fa-xmark-circle',
          color: 'text-error'
        };
      case 401:
        return {
          title: m.error_401_title(),
          description: m.error_401_description(),
          icon: 'fas fa-lock',
          color: 'text-warning'
        };
      case 410:
        return {
          title: m.error_410_title(),
          description: m.error_410_description(),
          icon: 'fas fa-trash',
          color: 'text-error'
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
    goto(resolve('/'));
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
  <title>{pageTitle(errorContent.title)}</title>
</svelte:head>

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
          <button class="btn btn-soft btn-secondary flex-1" onclick={tryAgain}>
            <i class="fas fa-refresh"></i>
            {m.try_again()}
          </button>

          <button class="btn btn-soft btn-ghost flex-1" onclick={reportIssue}>
            <i class="fas fa-bug"></i>
            {m.report_issue()}
          </button>
        </div>
      </div>
    </div>
  </div>
  <Footer class="mt-6" />
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
