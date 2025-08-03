<script lang="ts">
  import { base } from '$app/paths';
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
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    target?: '_blank' | '_self';
    class?: string;
  }

  let {
    user,
    showName = false,
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

  const statusSizeClasses = {
    xs: 'h-1 w-1 -right-1 -bottom-1',
    sm: 'h-2 w-2 -right-0.5 -bottom-0.5',
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
  function getInitials(user: Props['user']): string {
    const name = getDisplayName(user);
    if (!name) return '?';
    return name.trim()[0].toUpperCase();
  }
</script>

<a
  href="{base}/users/@{user.name}"
  {target}
  class="group flex items-center {gapClasses[size]} {className}"
  class:w-full={showName}
>
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

  <!-- Name (if showName is true) -->
  {#if showName}
    <div class="group-hover:text-accent min-w-0 flex-1 transition-colors">
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
</a>
