<script lang="ts">
  import { resolve } from '$app/paths';
  import { m } from '$lib/paraglide/messages';
  import { getDisplayName } from '$lib/utils';

  interface Props {
    user: {
      image?: string | null;
      displayName?: string | null;
      name?: string | null;
      lastActiveAt?: Date | string | null;
    };
    showName?: boolean;
    indicator?: string;
    align?: 'left' | 'right';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    target?: '_blank' | '_self' | null;
    class?: string;
  }

  let {
    user,
    showName = false,
    indicator,
    align = 'left',
    size = 'md',
    target = '_self',
    class: className = ''
  }: Props = $props();

  // Size mappings for avatar
  const avatarSizeClasses = {
    xs: 'w-6 h-6',
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-16 h-16',
    xl: 'w-24 h-24 sm:w-32 sm:h-32'
  };

  const gapClasses = {
    xs: 'gap-1',
    sm: 'gap-2',
    md: 'gap-3',
    lg: 'gap-4',
    xl: 'gap-5'
  };

  const indicatorSizeClasses = {
    xs: 'h-2 w-2 -right-0.5 -top-0.5',
    sm: 'h-2.5 w-2.5 -right-0.25 -top-0.25',
    md: 'h-3 w-3 right-0 top-0',
    lg: 'h-4 w-4 right-0.5 top-0.5',
    xl: 'w-4 h-4 sm:w-6 sm:h-6 right-1 top-1'
  };

  const statusSizeClasses = {
    xs: 'h-2 w-2 -right-0.5 -bottom-0.5',
    sm: 'h-2.5 w-2.5 -right-0.25 -bottom-0.25',
    md: 'h-3 w-3 right-0 bottom-0',
    lg: 'h-4 w-4 right-0.5 bottom-0.5',
    xl: 'w-4 h-4 sm:w-6 sm:h-6 right-1 bottom-1'
  };

  // Text size mappings for initials
  const textSizeClasses = {
    xs: 'text-xs',
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-lg',
    xl: 'text-xl sm:text-2xl'
  };

  // Get initials from display name or username
  const getInitials = (user: Props['user']): string => {
    const name = getDisplayName(user);
    if (!name) return '?';
    return name.trim()[0].toUpperCase();
  };
</script>

{#snippet content()}
  {#snippet avatar()}
    <!-- Avatar -->
    <div class="relative shrink-0">
      <div class="avatar {user.image ? '' : 'placeholder'}">
        <div
          class="rounded-full {avatarSizeClasses[size]} {user.image
            ? ''
            : 'bg-neutral text-neutral-content'}"
        >
          {#if user.image}
            <img src={user.image} alt="{getDisplayName(user)} {m.avatar()}" />
          {:else}
            <span class={textSizeClasses[size]}>
              {getInitials(user)}
            </span>
          {/if}
        </div>
      </div>

      {#if indicator}
        <div
          class="border-base-200 absolute rounded-full border-2 {indicator} {indicatorSizeClasses[
            size
          ]}"
        ></div>
      {/if}

      <!-- Online indicator -->
      {#if user.lastActiveAt}
        {@const isOnline = Date.now() - new Date(user.lastActiveAt).getTime() < 2 * 60 * 1000}
        {#if isOnline}
          <div
            class="border-base-200 absolute rounded-full border-2 bg-green-500 {statusSizeClasses[
              size
            ]}"
          ></div>
        {/if}
      {/if}
    </div>
  {/snippet}

  {#if align === 'left'}
    {@render avatar()}
  {/if}

  <!-- Name (if showName is true) -->
  {#if showName}
    <div
      class="group-hover:text-accent min-w-0 flex-1 transition-colors"
      class:text-right={align === 'right'}
    >
      {#if user.displayName}
        <div class="truncate font-medium">
          {user.displayName}
        </div>
        {#if user.displayName !== user.name && user.name}
          <div class="truncate text-sm opacity-60">
            @{user.name}
          </div>
        {/if}
      {:else if user.name}
        <div class="truncate font-medium">
          @{user.name}
        </div>
      {:else}
        <div class="truncate font-medium italic opacity-60">
          {m.anonymous_user()}
        </div>
      {/if}
    </div>
  {/if}

  {#if align === 'right'}
    {@render avatar()}
  {/if}
{/snippet}

{#if target !== null}
  <a
    href={resolve('/(main)/users/[id]', { id: '@' + user.name })}
    {target}
    class="group flex items-center {gapClasses[size]} {className}"
    class:w-full={showName}
  >
    {@render content()}
  </a>
{:else}
  <div class="group flex items-center {gapClasses[size]} {className}" class:w-full={showName}>
    {@render content()}
  </div>
{/if}
