<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { pageTitle, formatDateTime, formatDuration } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';
  import { m } from '$lib/paraglide/messages';
  import type { PageData } from './$types';

  type TaskState = 'idle' | 'running' | 'succeeded' | 'failed';
  type TaskId = 'university_stats' | 'campus_rankings' | 'region_rankings' | 'meilisearch';

  type Task = {
    id: TaskId;
    status: TaskState;
    startedAt?: Date | string | null;
    finishedAt?: Date | string | null;
    lastSuccessfulAt?: Date | string | null;
    updatedAt?: Date | string | null;
    durationMs?: number | null;
    lastError?: string | null;
    progress?: { processed: number; total: number | null } | null;
    summary?: Record<string, string | number | boolean | null> | null;
    triggerSource?: 'site_admin' | 'ssc' | null;
    triggerUserName?: string | null;
  };

  let { data }: { data: PageData } = $props();

  const taskMeta: Record<
    TaskId,
    { title: string; description: string; icon: string; summaryKeys: string[] }
  > = {
    university_stats: {
      title: m.admin_data_update_university_stats(),
      description: m.admin_data_update_university_stats_description(),
      icon: 'fa-building-columns',
      summaryKeys: ['processedCount', 'updatedCount', 'errorCount']
    },
    campus_rankings: {
      title: m.admin_data_update_campus_rankings(),
      description: m.admin_data_update_campus_rankings_description(),
      icon: 'fa-trophy',
      summaryKeys: ['processedCount', 'campusCount', 'totalCount']
    },
    region_rankings: {
      title: m.admin_data_update_region_rankings(),
      description: m.admin_data_update_region_rankings_description(),
      icon: 'fa-earth-americas',
      summaryKeys: ['totalCount']
    },
    meilisearch: {
      title: m.admin_data_update_meilisearch(),
      description: m.admin_data_update_meilisearch_description(),
      icon: 'fa-magnifying-glass',
      summaryKeys: ['indexedCount', 'shopCount', 'universityCount', 'clubCount']
    }
  };

  const summaryLabels: Record<string, string> = {
    processedCount: m.admin_data_update_summary_processed_count(),
    updatedCount: m.admin_data_update_summary_updated_count(),
    errorCount: m.admin_data_update_summary_error_count(),
    campusCount: m.admin_data_update_summary_campus_count(),
    totalCount: m.admin_data_update_summary_total_count(),
    indexedCount: m.admin_data_update_summary_indexed_count(),
    shopCount: m.admin_data_update_summary_shop_count(),
    universityCount: m.admin_data_update_summary_university_count(),
    clubCount: m.admin_data_update_summary_club_count()
  };

  let tasks = $state<Task[]>([]);
  let triggerUrl = $state('');
  let isRefreshing = $state(false);
  let activeTaskId = $state<TaskId | null>(null);
  let pollHandle: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    if (tasks.length === 0 && data.tasks) {
      tasks = [...(data.tasks as Task[])];
    }

    if (!triggerUrl && data.triggerUrl) {
      triggerUrl = data.triggerUrl;
    }
  });

  const hasRunningTasks = $derived(tasks.some((task) => task.status === 'running'));

  const refreshTasks = async (silent = false) => {
    if (!silent) {
      isRefreshing = true;
    }

    try {
      const response = await fetch(fromPath('/api/admin/data-updates'));
      if (!response.ok) {
        throw new Error('Failed to refresh tasks');
      }

      const result = await response.json();
      tasks = result.tasks || [];
      triggerUrl = result.triggerUrl || triggerUrl;
    } catch (error) {
      console.error('Failed to refresh admin data update tasks:', error);
    } finally {
      if (!silent) {
        isRefreshing = false;
      }
    }
  };

  const triggerTask = async (taskId: TaskId) => {
    activeTaskId = taskId;
    try {
      const response = await fetch(fromPath('/api/admin/data-updates'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ task: taskId })
      });

      if (!response.ok) {
        throw new Error('Failed to trigger data update task');
      }

      const result = await response.json();
      const updatedTask = result.task as Task;
      tasks = tasks.some((task) => task.id === updatedTask.id)
        ? tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task))
        : [...tasks, updatedTask];
      triggerUrl = result.triggerUrl || triggerUrl;
      await invalidateAll();
    } catch (error) {
      console.error('Failed to trigger admin data update task:', error);
    } finally {
      activeTaskId = null;
      await refreshTasks(true);
    }
  };

  const getStatusBadgeClass = (status: TaskState) => {
    switch (status) {
      case 'running':
        return 'badge-info';
      case 'succeeded':
        return 'badge-success';
      case 'failed':
        return 'badge-error';
      default:
        return 'badge-ghost';
    }
  };

  const getStatusText = (status: TaskState) => {
    switch (status) {
      case 'running':
        return m.admin_data_update_status_running();
      case 'succeeded':
        return m.admin_data_update_status_succeeded();
      case 'failed':
        return m.admin_data_update_status_failed();
      default:
        return m.admin_data_update_status_idle();
    }
  };

  const formatSummaryValue = (value: string | number | boolean | null | undefined) => {
    if (typeof value === 'boolean') {
      return value ? m.yes() : m.no();
    }
    if (value === null || value === undefined || value === '') {
      return m.unknown();
    }
    return String(value);
  };

  $effect(() => {
    if (hasRunningTasks) {
      if (!pollHandle) {
        pollHandle = setInterval(() => {
          void refreshTasks(true);
        }, 5000);
      }
    } else if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }

    return () => {
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    };
  });
</script>

<svelte:head>
  <title>{pageTitle(m.admin_data_updates(), m.admin_panel())}</title>
</svelte:head>

<div class="space-y-6">
  <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
    <div>
      <h1 class="text-base-content text-3xl font-bold">{m.admin_data_updates()}</h1>
      <p class="text-base-content/60 mt-1">{m.admin_data_updates_description()}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <button class="btn btn-soft" onclick={() => refreshTasks()} disabled={isRefreshing}>
        <i class="fa-solid fa-rotate-right"></i>
        {m.refresh()}
      </button>
    </div>
  </div>

  <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
    {#each tasks as task (task.id)}
      {@const meta = taskMeta[task.id]}
      <section class="bg-base-100 border-base-300 rounded-lg border p-6 shadow-sm">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="flex items-start gap-4">
              <div
                class="bg-primary/10 text-primary flex h-12 w-12 items-center justify-center rounded-full"
              >
                <i class={`fa-solid ${meta.icon} text-lg`}></i>
              </div>
              <div>
                <h2 class="text-base-content text-xl font-semibold">{meta.title}</h2>
                <p class="text-base-content/60 mt-1 text-sm">{meta.description}</p>
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class={`badge ${getStatusBadgeClass(task.status)}`}>
                {getStatusText(task.status)}
              </span>
              <button
                class="btn btn-primary btn-sm"
                onclick={() => triggerTask(task.id)}
                disabled={task.status === 'running' || activeTaskId === task.id}
              >
                {#if task.status === 'running'}
                  <span class="loading loading-spinner"></span>
                {:else}
                  <i class="fa-solid fa-play"></i>
                  {m.admin_data_update_run_now()}
                {/if}
              </button>
            </div>
          </div>

          {#if task.progress && task.status === 'running'}
            <div class="space-y-2">
              <div class="flex items-center justify-between text-sm">
                <span class="text-base-content/70">{m.progress()}</span>
                <span class="font-medium">
                  {task.progress.processed}
                  {#if task.progress.total !== null}
                    / {task.progress.total}
                  {/if}
                </span>
              </div>
              <progress
                class="progress progress-primary w-full"
                max={task.progress.total || Math.max(task.progress.processed, 1)}
                value={task.progress.processed}
              ></progress>
            </div>
          {/if}

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="bg-base-200 rounded-lg p-4">
              <div class="text-base-content/60 text-sm">{m.admin_data_update_last_started()}</div>
              <div class="mt-1 font-medium">{formatDateTime(task.startedAt)}</div>
            </div>
            <div class="bg-base-200 rounded-lg p-4">
              <div class="text-base-content/60 text-sm">{m.admin_data_update_last_finished()}</div>
              <div class="mt-1 font-medium">{formatDateTime(task.finishedAt)}</div>
            </div>
            <div class="bg-base-200 rounded-lg p-4">
              <div class="text-base-content/60 text-sm">
                {m.admin_data_update_last_successful()}
              </div>
              <div class="mt-1 font-medium">{formatDateTime(task.lastSuccessfulAt)}</div>
            </div>
            <div class="bg-base-200 rounded-lg p-4">
              <div class="text-base-content/60 text-sm">{m.admin_data_update_duration()}</div>
              <div class="mt-1 font-medium">
                {task.durationMs !== null && task.durationMs !== undefined
                  ? formatDuration(Math.round(task.durationMs / 1000))
                  : m.unknown()}
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div class="bg-base-200 rounded-lg p-4">
              <div class="text-base-content/60 text-sm">{m.admin_data_update_triggered_by()}</div>
              <div class="mt-1 font-medium">
                {task.triggerUserName || m.admin_data_update_system_trigger()}
              </div>
            </div>
            <div class="bg-base-200 rounded-lg p-4">
              <div class="text-base-content/60 text-sm">{m.admin_data_update_source()}</div>
              <div class="mt-1 font-medium">
                {task.triggerSource === 'ssc'
                  ? m.admin_data_update_source_ssc()
                  : task.triggerSource === 'site_admin'
                    ? m.admin_data_update_source_site_admin()
                    : m.unknown()}
              </div>
            </div>
          </div>

          <div class="bg-base-200 rounded-lg p-4">
            <div class="text-base-content/60 text-sm">{m.admin_data_update_summary()}</div>
            {#if task.summary}
              <dl class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {#each meta.summaryKeys as key (key)}
                  <div
                    class="bg-base-100 flex items-center justify-between gap-4 rounded px-3 py-2"
                  >
                    <dt class="text-base-content/70 text-sm">{summaryLabels[key] || key}</dt>
                    <dd class="text-sm font-medium">
                      {formatSummaryValue(task.summary[key])}
                    </dd>
                  </div>
                {/each}
              </dl>
            {:else}
              <p class="text-base-content/70 mt-2 text-sm">{m.admin_data_update_no_summary()}</p>
            {/if}
          </div>

          {#if task.lastError}
            <div class="alert alert-error alert-soft">
              <i class="fa-solid fa-circle-exclamation"></i>
              <span>{task.lastError}</span>
            </div>
          {/if}
        </div>
      </section>
    {/each}
  </div>
</div>
