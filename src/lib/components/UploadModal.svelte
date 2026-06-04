<script lang="ts">
  import { portal } from '$lib/actions/portal';
  import { m } from '$lib/paraglide/messages';
  import type { ImageStorageProvider } from '$lib/types';
  import { untrack } from 'svelte';
  import { fade } from 'svelte/transition';

  interface UploadResult {
    id: string;
    url: string;
    storageProvider: ImageStorageProvider;
    storageKey: string;
    storageObjectId?: string | null;
  }

  interface Props {
    isOpen: boolean;
    title?: string;
    confirmLabel?: string;
    accept?: string;
    uploadUrl: string;
    onSuccess?: (result: UploadResult) => void;
    onClose?: () => void;
  }

  let {
    isOpen = $bindable(),
    title,
    confirmLabel,
    accept = 'image/*',
    uploadUrl,
    onSuccess,
    onClose
  }: Props = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let selectedFiles = $state<File[]>([]);
  let previewUrls = $state<string[]>([]);
  let isDragOver = $state(false);

  // Upload phase tracking
  // 'idle' | 'uploading-to-server' | 'uploading-to-oss' | 'done' | 'error'
  let phase = $state<'idle' | 'uploading-to-server' | 'uploading-to-oss' | 'done' | 'error'>(
    'idle'
  );
  let browserServerProgress = $state(0); // 0–1: browser → server
  let serverOssProgress = $state(0); // 0–1: server → OSS
  let errorMessage = $state('');
  let currentUploadIndex = $state(0);
  let uploadedCount = $state(0);

  let isUploading = $derived(phase === 'uploading-to-server' || phase === 'uploading-to-oss');
  let selectedFileCount = $derived(selectedFiles.length);
  let currentFile = $derived(selectedFiles[currentUploadIndex] ?? null);

  const selectFiles = (files: File[]) => {
    for (const previewUrl of previewUrls) {
      URL.revokeObjectURL(previewUrl);
    }

    selectedFiles = files;
    previewUrls = files.map((file) => URL.createObjectURL(file));
  };

  const handleFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    selectFiles(Array.from(input.files ?? []));
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    isDragOver = false;
    if (isUploading || phase === 'done') return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) selectFiles(files);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!isUploading && phase !== 'done') isDragOver = true;
  };

  const handleDragLeave = (e: DragEvent) => {
    // Only clear if leaving the drop zone entirely (not entering a child)
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) {
      isDragOver = false;
    }
  };

  const reset = () => {
    for (const previewUrl of previewUrls) {
      URL.revokeObjectURL(previewUrl);
    }

    selectedFiles = [];
    previewUrls = [];
    phase = 'idle';
    browserServerProgress = 0;
    serverOssProgress = 0;
    errorMessage = '';
    isDragOver = false;
    currentUploadIndex = 0;
    uploadedCount = 0;
    if (fileInput) fileInput.value = '';
  };

  const handleClose = () => {
    if (isUploading) return;
    reset();
    isOpen = false;
    onClose?.();
  };

  const parseUploadEvent = (line: string) => {
    try {
      return JSON.parse(line) as {
        phase: string;
        progress?: number;
        imageId?: string;
        photoId?: string;
        url?: string;
        storageProvider?: ImageStorageProvider;
        storageKey?: string;
        storageObjectId?: string | null;
        message?: string;
      };
    } catch {
      return null;
    }
  };

  const uploadSingleFile = (file: File) =>
    new Promise<UploadResult>((resolve, reject) => {
      phase = 'uploading-to-server';
      browserServerProgress = 0;
      serverOssProgress = 0;

      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', uploadUrl);

      let responseBuffer = '';
      let uploadResult: UploadResult | null = null;
      let failedMessage = '';

      const handleEvent = (event: ReturnType<typeof parseUploadEvent>) => {
        if (!event) {
          return;
        }

        if (event.phase === 'uploading' && typeof event.progress === 'number') {
          phase = 'uploading-to-oss';
          serverOssProgress = event.progress;
          return;
        }

        if (
          event.phase === 'done' &&
          (event.imageId || event.photoId) &&
          event.url &&
          event.storageProvider &&
          event.storageKey
        ) {
          serverOssProgress = 1;
          uploadResult = {
            id: event.imageId || event.photoId || '',
            url: event.url,
            storageProvider: event.storageProvider,
            storageKey: event.storageKey,
            storageObjectId: event.storageObjectId ?? null
          };
          return;
        }

        if (event.phase === 'error') {
          failedMessage = event.message || m.image_upload_failed();
        }
      };

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          browserServerProgress = e.loaded / e.total;
        }
      });

      xhr.upload.addEventListener('load', () => {
        browserServerProgress = 1;
        phase = 'uploading-to-oss';
      });

      xhr.addEventListener('progress', () => {
        const newText = xhr.responseText.slice(responseBuffer.length);
        responseBuffer = xhr.responseText;

        for (const line of newText.split('\n')) {
          if (!line.trim()) continue;
          handleEvent(parseUploadEvent(line));
        }
      });

      xhr.addEventListener('load', () => {
        const remaining = xhr.responseText.slice(responseBuffer.length);
        if (remaining.trim()) {
          for (const line of remaining.split('\n')) {
            if (!line.trim()) continue;
            handleEvent(parseUploadEvent(line));
          }
        }

        if (uploadResult) {
          resolve(uploadResult);
          return;
        }

        reject(new Error(failedMessage || m.image_upload_failed()));
      });

      xhr.addEventListener('error', () => {
        reject(new Error(m.network_error_try_again()));
      });

      xhr.send(formData);
    });

  const doUpload = async () => {
    if (selectedFiles.length === 0 || isUploading) return;

    errorMessage = '';
    uploadedCount = 0;

    try {
      for (const [index, file] of selectedFiles.entries()) {
        currentUploadIndex = index;
        const result = await uploadSingleFile(file);
        uploadedCount = index + 1;
        onSuccess?.(result);
      }

      phase = 'done';
    } catch (error) {
      phase = 'error';
      errorMessage = error instanceof Error ? error.message : m.image_upload_failed();
    }
  };

  $effect(() => {
    if (!isOpen) {
      untrack(reset);
    }
  });
</script>

{#if isOpen}
  <div
    use:portal
    class="fixed inset-0 z-1020 flex items-center justify-center bg-black/60 p-4"
    onclick={(e) => {
      if (e.target === e.currentTarget) handleClose();
    }}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    }}
    role="button"
    tabindex="0"
    transition:fade={{ duration: 100 }}
  >
    <div
      class="bg-base-100 w-full max-w-md rounded-2xl p-6 shadow-xl"
      role="dialog"
      aria-modal="true"
    >
      <!-- Header -->
      <div class="mb-5 flex items-center justify-between">
        <h2 class="text-xl font-bold">{title ?? m.upload_image()}</h2>
        <button
          class="btn btn-ghost btn-circle btn-sm"
          onclick={handleClose}
          disabled={isUploading}
          aria-label={m.close()}
        >
          <i class="fa-solid fa-xmark text-lg"></i>
        </button>
      </div>

      {#if phase === 'idle' || phase === 'error'}
        <!-- File picker / drop zone area -->
        <div
          class="border-base-content/20 mb-4 flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 transition-colors {isDragOver
            ? 'border-primary bg-primary/10'
            : 'hover:border-primary'}"
          onclick={() => fileInput?.click()}
          onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
          ondrop={handleDrop}
          ondragover={handleDragOver}
          ondragleave={handleDragLeave}
          role="button"
          tabindex="0"
        >
          {#if previewUrls.length > 0}
            <div class="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
              {#each previewUrls.slice(0, 6) as previewUrl, index (previewUrl)}
                <div class="bg-base-200 overflow-hidden rounded-lg">
                  <img
                    src={previewUrl}
                    alt={selectedFiles[index]?.name ?? 'Preview'}
                    class="h-24 w-full object-cover"
                  />
                </div>
              {/each}
            </div>
            <span class="text-base-content/60 text-center text-sm">
              {m.selected_images({ count: selectedFileCount })}
            </span>
          {:else if isDragOver}
            <i class="fa-solid fa-file-arrow-down text-primary text-4xl"></i>
            <span class="text-primary text-sm font-medium">{m.drop_file_here()}</span>
          {:else}
            <i class="fa-solid fa-image text-base-content/30 text-4xl"></i>
            <span class="text-base-content/60 text-sm">
              {m.upload_click_or_drag_images()}
            </span>
          {/if}
        </div>

        <input
          bind:this={fileInput}
          type="file"
          class="hidden"
          {accept}
          multiple
          onchange={handleFileChange}
        />

        {#if phase === 'error'}
          <div class="alert alert-error alert-soft mb-4 py-2 text-sm">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>{errorMessage}</span>
          </div>
        {/if}

        <div class="flex gap-2">
          <button class="btn btn-ghost flex-1" onclick={handleClose}>
            {m.cancel()}
          </button>
          <button
            class="btn btn-primary flex-1"
            onclick={doUpload}
            disabled={selectedFiles.length === 0}
          >
            <i class="fa-solid fa-upload"></i>
            {confirmLabel ?? (selectedFiles.length > 1 ? m.upload_images() : m.upload_image())}
          </button>
        </div>
      {:else if isUploading}
        <!-- Progress display -->
        <div class="space-y-4">
          <div class="text-base-content/70 text-center text-sm font-medium">
            {m.uploading_image_progress({
              current: currentUploadIndex + 1,
              total: Math.max(selectedFiles.length, 1)
            })}
          </div>

          {#if currentFile}
            <div class="text-base-content/50 truncate text-center text-xs">{currentFile.name}</div>
          {/if}

          <!-- Phase 1 -->
          <div>
            <div class="mb-1 flex items-center justify-between text-sm">
              <span class="text-base-content/70">{m.uploading_to_server()}</span>
              <span class="text-base-content/50">{Math.round(browserServerProgress * 100)}%</span>
            </div>
            <progress class="progress progress-primary w-full" value={browserServerProgress} max="1"
            ></progress>
          </div>
          <!-- Phase 2 -->
          <div>
            <div class="mb-1 flex items-center justify-between text-sm">
              <span class="text-base-content/70">{m.uploading_to_cloud()}</span>
              <span class="text-base-content/50">
                {phase === 'uploading-to-oss' ? Math.round(serverOssProgress * 100) + '%' : '—'}
              </span>
            </div>
            <progress
              class="progress {phase === 'uploading-to-oss'
                ? 'progress-primary'
                : 'progress-base-200'} w-full"
              value={phase === 'uploading-to-oss' ? serverOssProgress : 0}
              max="1"
            ></progress>
          </div>
        </div>
      {:else if phase === 'done'}
        <div class="flex flex-col items-center gap-3 py-4">
          <div class="text-success text-5xl">
            <i class="fa-solid fa-circle-check"></i>
          </div>
          <p class="font-semibold">{m.done()}</p>
          <p class="text-base-content/60 text-sm">{m.uploaded_images({ count: uploadedCount })}</p>
          <button class="btn btn-primary mt-2 w-full" onclick={handleClose}>
            {m.close()}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
