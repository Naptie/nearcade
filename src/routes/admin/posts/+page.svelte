<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import { resolve } from '$app/paths';
  import { PostReadability } from '$lib/types';
  import type { PageData } from './$types';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { adaptiveNewTab, formatDate } from '$lib/utils';
  import AdminPage from '$lib/components/admin/AdminPage.svelte';
  import AdminStats from '$lib/components/admin/AdminStats.svelte';
  import AdminToolbar from '$lib/components/admin/AdminToolbar.svelte';
  import AdminPanel from '$lib/components/admin/AdminPanel.svelte';
  import AdminTable from '$lib/components/admin/AdminTable.svelte';
  import AdminPagination from '$lib/components/admin/AdminPagination.svelte';
  import AdminEmptyState from '$lib/components/admin/AdminEmptyState.svelte';
  import AdminRowActions from '$lib/components/admin/AdminRowActions.svelte';

  let { data }: { data: PageData } = $props();

  const getReadabilityLabel = (readability: PostReadability) => {
    switch (readability) {
      case PostReadability.PUBLIC:
        return m.public();
      case PostReadability.UNIV_MEMBERS:
        return m.university_members();
      case PostReadability.CLUB_MEMBERS:
        return m.club_members();
      default:
        return m.public();
    }
  };

  const getReadabilityIcon = (readability: PostReadability) => {
    switch (readability) {
      case PostReadability.PUBLIC:
        return 'fa-solid fa-globe';
      case PostReadability.UNIV_MEMBERS:
        return 'fa-solid fa-graduation-cap';
      case PostReadability.CLUB_MEMBERS:
        return 'fa-solid fa-users';
      default:
        return 'fa-solid fa-globe';
    }
  };
</script>

<AdminPage title={m.admin_posts()} description={m.admin_posts_description()}>
  {#snippet actions()}
    <AdminStats stats={[{ label: m.total_posts(), value: data.totalCount || 0 }]} />
  {/snippet}

  <AdminToolbar placeholder={m.admin_search_by_title_or_content()} total={data.totalCount} />

  <AdminPanel>
    {#if data.posts.length === 0}
      <AdminEmptyState
        icon="fa-file-lines"
        title={m.no_posts_found()}
        description={m.no_posts_found_description()}
      />
    {:else}
      <AdminTable>
        {#snippet head()}
          <tr>
            <th>{m.post_title()}</th>
            <th class="not-xs:hidden">{m.posted_by()}</th>
            <th class="not-md:hidden">{m.organization()}</th>
            <th class="not-md:hidden">{m.post_visibility()}</th>
            <th>{m.statistics()}</th>
            <th class="not-lg:hidden">{m.created_at()}</th>
            <th class="text-right not-lg:hidden">{m.actions()}</th>
          </tr>
        {/snippet}

        {#each data.posts as post (post.id)}
          <tr>
            <td>
              <div class="inline-flex flex-wrap gap-1 overflow-hidden">
                <a
                  class="hover:text-accent line-clamp-2 font-medium transition-colors"
                  href={post.universityId
                    ? resolve('/(main)/universities/[id]/posts/[postId]', {
                        id: post.universityId,
                        postId: post.id
                      })
                    : resolve('/(main)/clubs/[id]/posts/[postId]', {
                        id: post.clubId || '',
                        postId: post.id
                      })}
                >
                  {post.title}
                </a>
                <div class="flex items-center gap-1">
                  {#if post.isPinned}
                    <span class="btn btn-circle btn-soft btn-info badge-sm pointer-events-none">
                      <i class="fa-solid fa-thumbtack"></i>
                    </span>
                  {/if}
                  {#if post.isLocked}
                    <span class="btn btn-circle btn-soft btn-warning badge-sm pointer-events-none">
                      <i class="fa-solid fa-lock"></i>
                    </span>
                  {/if}
                </div>
              </div>
            </td>

            <td class="not-xs:hidden max-w-[25vw] sm:max-w-[15vw]">
              <UserAvatar user={post.author} size="sm" showName target={adaptiveNewTab()} />
            </td>

            <td class="not-md:hidden">
              <div class="flex items-center gap-2">
                {#if post.university}
                  <span class="not-xl:hidden">
                    <i class="fa-solid fa-graduation-cap text-primary"></i>
                  </span>
                  <a
                    class="hover:text-accent line-clamp-3 font-medium transition-colors"
                    href={resolve('/(main)/universities/[id]', {
                      id: post.university.slug || post.university.id
                    })}
                  >
                    {post.university.name}
                  </a>
                {:else if post.club}
                  <span class="not-xl:hidden">
                    <i class="fa-solid fa-users text-primary"></i>
                  </span>
                  <a
                    class="hover:text-accent line-clamp-3 font-medium transition-colors"
                    href={resolve('/(main)/clubs/[id]', { id: post.club.slug || post.club.id })}
                  >
                    {post.club.name}
                  </a>
                {/if}
              </div>
            </td>

            <td class="not-md:hidden">
              <span class="badge badge-soft gap-1 text-nowrap">
                <i class={getReadabilityIcon(post.readability)}></i>
                {getReadabilityLabel(post.readability)}
              </span>
            </td>

            <td>
              <div class="flex flex-row text-sm sm:gap-2.5">
                <span>
                  <i class="fa-solid fa-caret-up text-success mr-0.5"></i>
                  {post.upvotes}
                </span>
                <span>
                  <i class="fa-solid fa-caret-down text-error mr-0.5"></i>
                  {post.downvotes}
                </span>
                <span>
                  <i class="fa-solid fa-comment mr-0.5"></i>
                  {post.commentCount}
                </span>
              </div>
            </td>

            <td class="not-lg:hidden">
              <div class="text-sm">
                {formatDate(post.createdAt)}
              </div>
            </td>

            <td class="not-lg:hidden">
              <AdminRowActions>
                <a
                  class="btn btn-ghost btn-sm"
                  href={post.universityId
                    ? resolve('/(main)/universities/[id]/posts/[postId]', {
                        id: post.universityId,
                        postId: post.id
                      })
                    : resolve('/(main)/clubs/[id]/posts/[postId]', {
                        id: post.clubId || '',
                        postId: post.id
                      })}
                  title={m.view()}
                  aria-label={m.view()}
                >
                  <i class="fa-solid fa-eye"></i>
                </a>
              </AdminRowActions>
            </td>
          </tr>
        {/each}
      </AdminTable>

      <AdminPagination
        currentPage={data.currentPage}
        hasMore={data.hasMore}
        total={data.totalCount}
        pageSize={data.pageSize}
      />
    {/if}
  </AdminPanel>
</AdminPage>
