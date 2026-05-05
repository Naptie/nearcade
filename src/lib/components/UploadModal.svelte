<script lang="ts">
  import { m } from '$lib/paraglide/messages';

  interface UploadResult {
    photoId: string;
    url: string;
  }

  interface Props {
    isOpen: boolean;
    title?: string;
    accept?: string;
    uploadUrl: string;
    onSuccess?: (result: UploadResult) => void;
    onClose?: () => void;
  }

  let {
    isOpen = $bindable(),
    title,
    accept = 'image/*',
    uploadUrl,
    onSuccess,
    onClose
  }: Props = $props();

  let fileInput = $state<HTMLInputElement | null>(null);
  let selectedFile = $state<File | null>(null);
  let previewUrl = $state<string | null>(null);

  // Upload phase tracking
  // 'idle' | 'uploading-to-server' | 'uploading-to-oss' | 'done' | 'error'
  let phase = $state<'idle' | 'uploading-to-server' | 'uploading-to-oss' | 'done' | 'error'>(
    'idle'
  );
  let browserServerProgress = $state(0); // 0–1: browser → server
  let serverOssProgress = $state(0); // 0–1: server → OSS
  let errorMessage = $state('');

  let isUploading = $derived(phase === 'uploading-to-server' || phase === 'uploading-to-oss');

  const handleFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    selectedFile = file;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    if (file) {
      previewUrl = URL.createObjectURL(file);
    }
  };

  const reset = () => {
    selectedFile = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    phase = 'idle';
    browserServerProgress = 0;
    serverOssProgress = 0;
    errorMessage = '';
    if (fileInput) fileInput.value = '';
  };

  const handleClose = () => {
    if (isUploading) return;
    reset();
    isOpen = false;
    onClose?.();
  };

  const doUpload = () => {
    if (!selectedFile || isUploading) return;

    phase = 'uploading-to-server';
    browserServerProgress = 0;
    serverOssProgress = 0;
    errorMessage = '';

    const formData = new FormData();
    formData.append('file', selectedFile);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);

    // Phase 1: browser → server
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        browserServerProgress = e.loaded / e.total;
      }
    });

    xhr.upload.addEventListener('load', () => {
      browserServerProgress = 1;
      phase = 'uploading-to-oss';
    });

    // Phase 2: server → OSS (streaming NDJSON)
    let responseBuffer = '';
    xhr.addEventListener('progress', () => {
      const newText = xhr.responseText.slice(responseBuffer.length);
      responseBuffer = xhr.responseText;
      const lines = newText.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as {
            phase: string;
            progress?: number;
            photoId?: string;
            url?: string;
            message?: string;
          };
          if (event.phase === 'uploading' && typeof event.progress === 'number') {
            serverOssProgress = event.progress;
          } else if (event.phase === 'done' && event.photoId && event.url) {
            serverOssProgress = 1;
            phase = 'done';
            onSuccess?.({ photoId: event.photoId, url: event.url });
          } else if (event.phase === 'error') {
            phase = 'error';
            errorMessage = event.message || m.shop_photo_upload_failed();
          }
        } catch {
          // Non-JSON line — ignore
        }
      }
    });

    xhr.addEventListener('load', () => {
      // Final parse in case the last progress event was missed
      const remaining = xhr.responseText.slice(responseBuffer.length);
      if (remaining.trim()) {
        for (const line of remaining.split('\n')) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as {
              phase: string;
              progress?: number;
              photoId?: string;
              url?: string;
              message?: string;
            };
            if (event.phase === 'done' && event.photoId && event.url) {
              serverOssProgress = 1;
              phase = 'done';
              onSuccess?.({ photoId: event.photoId, url: event.url });
            } else if (event.phase === 'error') {
              if (phase !== 'done') {
                phase = 'error';
                errorMessage = event.message || m.shop_photo_upload_failed();
              }
            }
          } catch {
            // ignore
          }
        }
      }
      // If still not done after reading all response lines, treat as error
      if (phase !== 'done' && phase !== 'error') {
        phase = 'error';
        errorMessage = m.shop_photo_upload_failed();
      }
    });

    xhr.addEventListener('error', () => {
      phase = 'error';
      errorMessage = m.network_error_try_again();
    });

    xhr.send(formData);
  };
</script>

{#if isOpen}
  <!-- Modal backdrop -->
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    onclick={(e) => {
      if (e.target === e.currentTarget) handleClose();
    }}
  >
    <div
      class="bg-base-100 w-full max-w-md rounded-2xl p-6 shadow-xl"
      role="dialog"
      aria-modal="true"
    >
      <!-- Header -->
      <div class="mb-5 flex items-center justify-between">
        <h2 class="text-xl font-bold">{title ?? m.upload_an_image()}</h2>
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
        <!-- File picker area -->
        <div
          class="border-base-300 hover:border-primary mb-4 flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 transition-colors"
          onclick={() => fileInput?.click()}
          onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
          role="button"
          tabindex="0"
        >
          {#if previewUrl}
            <img src={previewUrl} alt="Preview" class="max-h-48 rounded-lg object-contain shadow" />
            <span class="text-base-content/60 text-sm">{selectedFile?.name}</span>
          {:else}
            <i class="fa-solid fa-image text-base-content/30 text-4xl"></i>
            <span class="text-base-content/60 text-sm">
              {m.upload_an_image()}
            </span>
          {/if}
        </div>

        <input
          bind:this={fileInput}
          type="file"
          class="hidden"
          {accept}
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
          <button class="btn btn-primary flex-1" onclick={doUpload} disabled={!selectedFile}>
            <i class="fa-solid fa-upload"></i>
            {m.shop_photos_upload()}
          </button>
        </div>
      {:else if isUploading}
        <!-- Progress display -->
        <div class="space-y-4">
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
          <button class="btn btn-primary mt-2 w-full" onclick={handleClose}>
            {m.close()}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}
