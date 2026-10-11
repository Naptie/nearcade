<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import {
    adaptiveNewTab,
    aggregateGames,
    calculateDistance,
    convertCoordinates,
    formatDateTime,
    formatHourLiteral,
    formatOpeningHourLiteral,
    formatShopAddress,
    formatTime,
    getFnsLocale,
    getGameName,
    getMyLocation,
    getShopTimezone,
    getShopOpeningHours,
    isShopCurrentlyOpen,
    isShopChinaBased,
    pageTitle,
    sanitizeHTML
  } from '$lib/utils';
  import { canonicalizeOpeningHourPair } from '$lib/utils/shops/derived';
  import { ATTENDANCE_RADIUS_KM, GAME_TITLES } from '$lib/constants';
  import { getContext } from 'svelte';
  import type { AMapContext, QueueRecord, QueuePosition, QueueMember } from '$lib/types';
  import { browser } from '$app/environment';
  import type { AttendanceData, AttendanceReport } from '$lib/types';
  import { fromPath } from '$lib/utils/scoped';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { fromZonedTime } from 'date-fns-tz';
  import { getLocale } from '$lib/paraglide/runtime';
  import { hasBoundPhone } from '$lib/utils';
  import { phoneRequiredToast } from '$lib/notifications/phone-required';
  import FancyButton from '$lib/components/FancyButton.svelte';
  import type { User } from '$lib/auth/types';
  import AttendanceReportBlame from '$lib/components/AttendanceReportBlame.svelte';
  import JsonLd from '$lib/components/JsonLd.svelte';
  import {
    buildShopSchema,
    buildBreadcrumbSchema,
    buildKeywords,
    getCanonicalUrl,
    toAbsoluteUrl
  } from '$lib/utils/seo';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import AttendanceReports from '$lib/components/AttendanceReports.svelte';
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import Comment from '$lib/components/Comment.svelte';
  import type { OpeningHourTime } from '$lib/types';
  import type { OpeningHourEntry } from '$lib/utils/shops/derived';
  import { render } from '$lib/utils/markdown';
  import PhotoCarousel from '$lib/components/PhotoCarousel.svelte';
  import ShopChangelogView from '$lib/components/ShopChangelogView.svelte';
  import type { ShopPhoto } from '$lib/types';
  import VerifiedContactPrompt from '$lib/components/VerifiedContactPrompt.svelte';
  import { maybeShowUgcTranslationPrompt } from '$lib/ugc/client';
  import T from '$lib/ugc/components/T.svelte';
  import InlineAlert from '$lib/components/InlineAlert.svelte';
  import MetaRobots from '$lib/components/MetaRobots.svelte';
  import { adaptiveIcon } from '$lib/actions/adaptive-icon';
  import StarShopButton from '$lib/components/shops/StarShopButton.svelte';
  import ShopActionsMenu from '$lib/components/shops/ShopActionsMenu.svelte';
  import ShopRollbackDialog from '$lib/components/shops/ShopRollbackDialog.svelte';
  import { goto } from '$app/navigation';
  import ShopAttendanceActions, {
    type ReportedAttendanceSummary
  } from '$lib/components/shops/ShopAttendanceActions.svelte';
  import CommentComposer from '$lib/components/shops/CommentComposer.svelte';
  import PendingDeleteRequestCard from '$lib/components/shops/PendingDeleteRequestCard.svelte';
  import DeleteRequestModal from '$lib/components/shops/DeleteRequestModal.svelte';

  let { data }: { data: PageData } = $props();

  // Wait for shop data and handle loading/error states separately
  let shopDataResolved = $state<Awaited<typeof data.shopData> | null>(null);
  let shopDataError = $state<Error | null>(null);
  let shopDataLoading = $state(true);

  $effect(() => {
    shopDataLoading = true;
    shopDataError = null;
    data.shopData
      .then((resolved) => {
        shopDataResolved = resolved;
        shopDataLoading = false;
      })
      .catch((err) => {
        shopDataError = err;
        shopDataLoading = false;
      });
  });

  // SEO-critical shop data is available immediately from the server load
  let shop = $derived(data.shop);
  let pageLocale = $derived(getLocale());
  let firstPhoto = $derived(data.firstPhoto);
  let canonicalUrl = $derived(getCanonicalUrl(page.url));
  let ogImage = $derived(firstPhoto?.url ? toAbsoluteUrl(firstPhoto.url, page.url.origin) : null);
  let shopSchema = $derived(buildShopSchema(shop, canonicalUrl, ogImage ?? undefined));
  let breadcrumbSchema = $derived(
    buildBreadcrumbSchema([
      { name: m.home(), item: `${page.url.origin}/` },
      { name: m.browse_shops(), item: `${page.url.origin}/shops` },
      { name: shop.name }
    ])
  );
  let currentAttendanceFromServer = $derived(data.currentAttendance);
  let pendingDeleteRequest = $derived(shopDataResolved?.pendingDeleteRequest);
  let photosFromServer = $derived(shopDataResolved?.photos ?? []);
  let shopOwner = $derived(shopDataResolved?.shopOwner ?? null);
  // eslint-disable-next-line svelte/prefer-writable-derived
  let photos = $state<ShopPhoto[]>([]);

  $effect(() => {
    photos = photosFromServer;
  });
  let isAdmin = $derived(data.user?.userType === 'site_admin');
  let hasPhone = $derived(hasBoundPhone(data.user) || isAdmin);
  /** Site admins fall back to the `deleted_shops` archive for removed shops;
   * the page then renders a read-only snapshot with mutations disabled. */
  let isDeletedPreview = $derived(!!data.deletedPreview);
  /** `?at=<entryId>` renders the shop reconstructed at a changelog entry —
   * same read-only treatment as the deleted-shop snapshot. */
  let isTimePointPreview = $derived(!!data.timePointPreview);
  let isPreview = $derived(isDeletedPreview || isTimePointPreview);
  let showRollbackDialog = $state(false);
  let isShopOwner = $derived(!!data.user && !!shop?.ownerId && shop.ownerId === data.user.id);
  let canModifyClaimedShop = $derived(!shop?.isClaimed || isAdmin || isShopOwner);
  let canModifyLockedShop = $derived(!shop?.isLocked || isAdmin);
  let canProtectedShopAction = $derived(
    !!data.user && hasPhone && canModifyClaimedShop && canModifyLockedShop
  );
  /** Commenting is independent of shop management: claimed or locked shops
   * still accept comments from any signed-in user with a bound phone. */
  let canComment = $derived(!!data.user && hasPhone);
  /** Read-only snapshots also strip comment interactions, not just composers. */
  let canInteractComments = $derived(canComment && !isPreview);
  let protectedShopActionMessage = $derived.by(() => {
    if (!data.user) {
      return '';
    }

    if (shop?.isLocked && !isAdmin) {
      return m.shop_locked_description();
    }

    if (shop?.isClaimed && !isAdmin && !isShopOwner) {
      return m.insufficient_permissions();
    }

    if (!hasPhone) {
      return m.phone_binding_required();
    }
  });

  /** True when the only thing blocking protected actions is a missing bound
   * phone number. Only then do we enable the action and warn via toast. */
  const isPhoneRequired = $derived(
    (protectedShopActionMessage ?? '') === m.phone_binding_required()
  );
  let attendanceData = $state<AttendanceData>([]);
  let attendanceReport = $state<AttendanceReport>([]);
  let reportedAttendances = $state<ReportedAttendanceSummary[]>([]);
  let totalAttendance = $state(0);
  let openingHours = $derived(shop && getShopOpeningHours(shop));
  let showOpeningHoursInUserTime = $state(false);
  let now = $state(new Date());
  let isShopOpen = $derived(!!shop && isShopCurrentlyOpen(shop, now));
  let otherShop = $derived.by(() => {
    if (!currentAttendanceFromServer) return false;
    const attendance = currentAttendanceFromServer;
    return shop && attendance.shop.id !== shop.id ? attendance : false;
  });
  let hovered = $state<Record<number, boolean>>({});
  let costs: Record<string, string> = $state({});

  // Queue data for claimed shops
  type EnrichedQueueMember = QueueMember & { user?: User | null };
  type EnrichedQueuePosition = Omit<QueuePosition, 'members'> & { members: EnrichedQueueMember[] };
  type EnrichedQueueRecord = Omit<QueueRecord['games'][number], 'queue'> & {
    queue: EnrichedQueuePosition[];
  };
  let queueData = $state<EnrichedQueueRecord[]>([]);

  let isChangelogOpen = $derived(page.url.hash === '#changelog');

  // Attendance mutations (attend/leave/report) live in ShopAttendanceActions;
  // the games list reaches the shared report modal through this ref.
  let attendanceActions: ShopAttendanceActions | null = $state(null);

  let radius = $state(10);

  // Location checking for attendance
  const amapContext = getContext<AMapContext>('amap');
  let amap = $derived(amapContext?.amap);
  let distance = $state<number | null>(null); // Distance to shop
  let isUserNearShop = $state<boolean | null>(null); // null = checking, true/false = result
  let locationError = $state<string | null>(null);
  let shopComment = $state({ rendered: false, content: '' });
  let gameComments: Record<string, string> = $state({});

  const getAttendanceData = async () => {
    if (!shop || shop.isClaimed) return;
    try {
      const attendanceResponse = await fetch(fromPath(`/api/shops/${shop.id}/attendance`));
      if (attendanceResponse.ok) {
        const result = (await attendanceResponse.json()) as {
          total: number;
          registered: AttendanceData;
          reported: AttendanceReport;
        };
        totalAttendance = result.total || 0;
        attendanceData = result.registered || [];
        attendanceReport = result.reported || [];
        reportedAttendances = shop.games
          .map((g) => {
            const reportedAttendance = getGameReportedAttendance(g.gameId);
            if (!reportedAttendance) return undefined;
            return {
              ...reportedAttendance,
              id: g.gameId,
              count:
                (reportedAttendance.count || 0) +
                attendanceData.filter(
                  (a) =>
                    a.gameId === g.gameId &&
                    new Date(a.attendedAt) > new Date(reportedAttendance.reportedAt)
                ).length
            };
          })
          .filter((r) => r !== undefined) as typeof reportedAttendances;
      }
    } catch (err) {
      console.warn('Failed to load attendance data:', err);
    }
  };

  const getQueueData = async () => {
    if (!shop || !shop.isClaimed) return;
    try {
      const queueResponse = await fetch(fromPath(`/api/shops/${shop.id}/queues`));
      if (queueResponse.ok) {
        const result = (await queueResponse.json()) as {
          success: boolean;
          queues: EnrichedQueueRecord[];
        };
        queueData = result.queues || [];
      }
    } catch (err) {
      console.warn('Failed to load queue data:', err);
    }
  };

  onMount(() => {
    const savedRadius = localStorage.getItem('nearcade-radius');
    if (savedRadius) {
      radius = parseInt(savedRadius);
    }

    const interval = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(interval);
  });

  $effect(() => {
    if (shop) {
      // First-visit AI translation invitation (shop name/description/address
      // render server-attached translations directly, so trigger it here).
      if (!isPreview) {
        maybeShowUgcTranslationPrompt();

        // For claimed shops, fetch queue data; otherwise fetch attendance data
        if (shop.isClaimed) {
          getQueueData();
        } else {
          getAttendanceData();
        }
      }
      render(shop._t?.shop_description?.[pageLocale] ?? shop.comment).then((content) => {
        shopComment = { rendered: true, content };
      });

      Promise.all(
        shop.games.map(async (game) => {
          const translatedComment = game._t?.game_description?.[pageLocale] ?? game.comment;
          gameComments[game.gameId] = await render(translatedComment);
          costs[game.gameId] = await sanitizeHTML(game.cost);
        })
      );

      // Check user location proximity to shop
      if (!isPreview) {
        checkUserProximity();
      }
    }
  });

  const checkUserProximity = async () => {
    if (!shop || shop.isClaimed) return;
    try {
      // Get user's current location
      const location = await getMyLocation();

      // Convert coordinates using AMap if available
      let convertedLocation = { ...location };
      if (amap) {
        convertedLocation = await convertCoordinates(convertedLocation, amap);
      }

      // Calculate distance to shop
      const shopCoords = shop.location.coordinates;
      distance = calculateDistance(
        convertedLocation.latitude,
        convertedLocation.longitude,
        shopCoords[1], // latitude
        shopCoords[0] // longitude
      );

      // Check if within attendance radius
      isUserNearShop = distance <= ATTENDANCE_RADIUS_KM;
    } catch (error) {
      console.warn('Failed to get user location:', error);
      locationError = typeof error === 'string' ? error : m.location_unknown_error();
      isUserNearShop = false;
    }
  };

  const getGameInfo = (titleId: number) => {
    return GAME_TITLES.find((g) => g.id === titleId);
  };

  const DAY_LABELS = () => [
    m.monday(),
    m.tuesday(),
    m.wednesday(),
    m.thursday(),
    m.friday(),
    m.saturday(),
    m.sunday()
  ];

  const JS_DAY_LABELS = () => [
    m.sunday(),
    m.monday(),
    m.tuesday(),
    m.wednesday(),
    m.thursday(),
    m.friday(),
    m.saturday()
  ];

  const openingHourTotalMinutes = (time: OpeningHourTime) => time.hour * 60 + time.minute;

  const formatShopOpeningHourPair = (pair: OpeningHourEntry) => {
    const [open, close] = canonicalizeOpeningHourPair(pair[0], pair[1]);
    const openStr = formatOpeningHourLiteral(open);
    // `formatOpeningHourLiteral` folds a 24–47 close back to wall-clock time.
    const closeStr = formatOpeningHourLiteral(close);
    return close.hour >= 24
      ? `${openStr} – ${m.tomorrow()} ${closeStr}`
      : `${openStr} – ${closeStr}`;
  };

  const formatUserSingleOpeningHourPair = (open: Date, close: Date) => {
    const sameUserDay =
      open.getDate() === close.getDate() &&
      open.getMonth() === close.getMonth() &&
      open.getFullYear() === close.getFullYear();
    const openStr = formatTime(open);
    const closeStr = formatTime(close);
    if (!sameUserDay) {
      return `${openStr} – ${m.tomorrow()} ${closeStr}`;
    }
    return `${openStr} – ${closeStr}`;
  };

  const padTimePart = (value: number) => String(value).padStart(2, '0');

  const makeZonedDate = (
    timeZone: string,
    dateParts: { year: number; month: number; day: number },
    time: OpeningHourTime
  ) =>
    fromZonedTime(
      `${dateParts.year}-${padTimePart(dateParts.month)}-${padTimePart(dateParts.day)}T${padTimePart(
        time.hour
      )}:${padTimePart(time.minute)}:00`,
      timeZone
    );

  const getShopWeekDateParts = (weekdayIndex: number) => {
    if (!shop) return undefined;
    const timeZone = getShopTimezone(shop);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6
    };
    const currentJsDay = weekdayMap[part('weekday')] ?? 0;
    const daysSinceMonday = (currentJsDay + 6) % 7;
    const mondayUtc = Date.UTC(
      Number(part('year')),
      Number(part('month')) - 1,
      Number(part('day')) - daysSinceMonday
    );
    const targetDate = new Date(mondayUtc + weekdayIndex * 24 * 60 * 60 * 1000);

    return {
      timeZone,
      year: targetDate.getUTCFullYear(),
      month: targetDate.getUTCMonth() + 1,
      day: targetDate.getUTCDate()
    };
  };

  const formatUserOpeningHourPair = (pair: OpeningHourEntry, weekdayIndex: number) => {
    const dateParts = getShopWeekDateParts(weekdayIndex);
    if (!dateParts) return formatShopOpeningHourPair(pair);

    const [openTime, closeTime] = canonicalizeOpeningHourPair(pair[0], pair[1]);
    const open = makeZonedDate(dateParts.timeZone, dateParts, openTime);
    // The canonical close is always a positive delta past the open, so the day
    // spill falls out of the arithmetic instead of being rebuilt from date parts.
    const durationMs =
      (openingHourTotalMinutes(closeTime) - openingHourTotalMinutes(openTime)) * 60 * 1000;
    const close = new Date(open.getTime() + durationMs);
    const expectedOpenDay = (weekdayIndex + 1) % 7;
    const expectedCloseDay = (expectedOpenDay + (closeTime.hour >= 24 ? 1 : 0)) % 7;
    const showOpenDay = open.getDay() !== expectedOpenDay;
    // Suppress the close day only when the close really is on the open's own
    // user-calendar day. A 24-hour row otherwise renders as `06:00 – 06:00`,
    // which reads as a zero-length session.
    const closeOnLaterDay =
      close.getFullYear() !== open.getFullYear() ||
      close.getMonth() !== open.getMonth() ||
      close.getDate() !== open.getDate();
    const showCloseDay = closeOnLaterDay || close.getDay() !== expectedCloseDay || showOpenDay;
    const labels = JS_DAY_LABELS();
    const openLabel = `${showOpenDay ? `${labels[open.getDay()]} ` : ''}${formatTime(open)}`;
    const closeLabel = `${showCloseDay ? `${labels[close.getDay()]} ${formatTime(close)}` : formatTime(close)}`;

    return `${openLabel} – ${closeLabel}`;
  };

  const getUserOffset = () => {
    const minutes = now.getTimezoneOffset();
    const sign = minutes <= 0 ? '+' : '-';
    return `${sign}${formatHourLiteral(Math.abs(minutes / 60))}`;
  };

  const getShopOffset = () => {
    if (!openingHours) return '+00:00';
    const hours = openingHours.offsetHours;
    const sign = hours >= 0 ? '+' : '-';
    return `${sign}${formatHourLiteral(Math.abs(hours))}`;
  };

  const getGameAttendance = (id: number): number => {
    if (!attendanceData) return 0;
    return attendanceData.filter((attendee) => attendee.gameId === id).length;
  };

  const getGameReportedAttendance = (id: number) => {
    if (!attendanceReport) return undefined;
    // Get the most recent reported attendance for this game
    const attendeesWithReported = attendanceReport.filter(
      (attendee) => attendee.gameId === id && attendee.currentAttendances !== undefined
    );
    if (attendeesWithReported.length === 0) return undefined;

    // Return the most recent reported value
    const mostRecent = attendeesWithReported.reduce((latest, current) =>
      new Date(current.reportedAt) > new Date(latest.reportedAt) ? current : latest
    );
    return {
      count: mostRecent.currentAttendances,
      reportedBy: mostRecent.reporter,
      reportedAt: mostRecent.reportedAt,
      comment: mostRecent.comment
    };
  };

  // Helper to get queue data for a specific game
  const getGameQueue = (gameId: number) => {
    return queueData.find((q) => q.gameId === gameId);
  };

  // Get position styling class based on status and privacy
  const getPositionClass = (status: string, isPublic: boolean) => {
    switch (status) {
      case 'playing':
        return 'bg-orange-500/20 border-orange-500';
      case 'queued':
        return isPublic ? 'bg-cyan-500/20 border-cyan-500' : 'bg-violet-500/20 border-violet-500';
      default:
        return 'bg-gray-500/20 border-gray-500';
    }
  };

  // Get status label
  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'playing':
        return m.queue_status_playing();
      case 'queued':
        return m.queue_status_queued();
      case 'deferred':
        return m.queue_status_deferred();
      default:
        return status;
    }
  };

  // Helper to get total attendance from queue data
  const getQueueTotalAttendance = (): number => {
    return queueData.reduce((total, queue) => {
      return total + queue.queue.reduce((count, position) => count + position.members.length, 0);
    }, 0);
  };

  // Helper to get game attendance from queue data
  const getQueueGameAttendance = (gameId: number): number => {
    const gameQueue = queueData.find((q) => q.gameId === gameId);
    if (!gameQueue) return 0;
    return gameQueue.queue.reduce((count, position) => count + position.members.length, 0);
  };

  // Derived total attendance for claimed shops (from queue) or regular shops (from attendance data)
  let displayTotalAttendance = $derived(
    shop?.isClaimed ? getQueueTotalAttendance() : totalAttendance
  );

  // Refresh data every 30 seconds
  $effect(() => {
    if (!browser || isPreview) return;

    const interval = setInterval(shop?.isClaimed ? getQueueData : getAttendanceData, 30000);
    return () => clearInterval(interval);
  });

  // Comment section state
  let comments = $derived(shopDataResolved?.comments ?? []);
  let replyingTo = $state<string | null>(null);
  let isCommentsRendered = $state(false);

  // Delete request modal open state (the modal itself lives in DeleteRequestModal)
  let showDeleteRequestModal = $state(false);

  onMount(() => {
    isCommentsRendered = true;
  });

  const handleCommentVote = async (commentId: string, voteType: 'upvote' | 'downvote') => {
    if (!canComment) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${commentId}/vote`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voteType })
      });

      if (response.ok) {
        invalidateAll();
      }
    } catch (error) {
      console.error('Error voting on comment:', error);
    }
  };

  const handleCommentReply = (commentId: string) => {
    if (!canComment) return;
    // Any discarded reply composer cleans up its own draft images on destroy.
    replyingTo = commentId;
  };

  const handleCommentEdit = async (commentId: string, newContent: string, imageIds: string[]) => {
    if (!canComment) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${commentId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent, images: imageIds })
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { message: string };
        throw new Error(errorData.message || 'Failed to edit comment');
      }

      invalidateAll();
    } catch (error) {
      console.error('Error editing comment:', error);
      throw error;
    }
  };

  const handleCommentDelete = async (commentId: string) => {
    if (!canComment) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${commentId}`), {
        method: 'DELETE'
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { message: string };
        alert(errorData.message || 'Failed to delete comment');
      } else {
        invalidateAll();
      }
    } catch (error) {
      console.error('Error deleting comment:', error);
      alert(m.network_error_try_again());
    }
  };
</script>

<svelte:head>
  {#if shop}
    <title>{pageTitle(shop.name)}</title>
    <meta name="description" content={`${shop.name} - ${formatShopAddress(shop)}`} />
    <meta
      name="keywords"
      content={buildKeywords([
        shop.name,
        formatShopAddress(shop),
        ...(shop.games?.map((game) => game.name) ?? [])
      ])}
    />
    <meta property="og:title" content={pageTitle(shop.name, m.shop_details())} />
    <meta property="og:description" content={`${shop.name} - ${formatShopAddress(shop)}`} />
    {#if ogImage}
      <meta property="og:image" content={ogImage} />
    {/if}
    <meta name="twitter:title" content={pageTitle(shop.name, m.shop_details())} />
    <meta name="twitter:description" content={`${shop.name} - ${formatShopAddress(shop)}`} />
    <meta name="twitter:card" content={ogImage ? 'summary_large_image' : 'summary'} />
    {#if ogImage}
      <meta name="twitter:image" content={ogImage} />
    {/if}
  {:else}
    <title>{pageTitle(m.shop_details())}</title>
  {/if}
</svelte:head>

{#if isPreview}
  <MetaRobots />
{/if}

{#if !isPreview}
  <JsonLd schema={shopSchema} />
  <JsonLd schema={breadcrumbSchema} />
{/if}

{#if !shopDataResolved && shopDataLoading}
  <!-- Loading State with Skeleton -->
  <div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
    <div class="md:grid md:grid-cols-5 md:gap-8 lg:grid-cols-3">
      <div class="order-1 not-md:mb-6 md:col-span-2 lg:col-span-1">
        <div class="space-y-6">
          <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
          {#each Array(4) as _, idx (idx)}
            <div class="card bg-base-200">
              <div class="card-body p-6">
                <div class="skeleton mb-4 h-6 w-32"></div>
                <div class="space-y-2">
                  <div class="skeleton h-4 w-full"></div>
                  <div class="skeleton h-4 w-full"></div>
                  <div class="skeleton h-4 w-full"></div>
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
      <div class="md:col-span-3 lg:col-span-2">
        <div class="space-y-4">
          <div class="skeleton mb-4 h-10 w-3/4"></div>
          <div class="alert alert-success alert-soft h-18 w-full"></div>
          <!-- eslint-disable-next-line @typescript-eslint/no-unused-vars -->
          {#each Array(3) as _, idx (idx)}
            <div class="card bg-base-200">
              <div class="card-body p-6">
                <div class="skeleton h-8 w-1/2"></div>
                <div class="skeleton mt-4 h-20 w-full"></div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
{:else if shopDataError}
  <!-- Error State -->
  <div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
    <div class="py-12 text-center">
      <div class="text-error mb-4">
        <i class="fa-solid fa-exclamation-triangle text-4xl"></i>
      </div>
      <h3 class="mb-2 text-xl font-semibold">{m.failed_to_load_shop()}</h3>
      <p class="text-base-content/60 mb-4">
        {shopDataError.message || m.error_occurred()}
      </p>
      <button class="btn btn-primary" onclick={() => window.location.reload()}>
        <i class="fa-solid fa-refresh"></i>
        {m.try_again()}
      </button>
    </div>
  </div>
{:else if shop}
  <!-- Loaded Content -->
  <div class="mx-auto max-w-7xl px-4 pt-20 pb-8 sm:px-6 lg:px-8">
    {#if isDeletedPreview && data.deletedPreview}
      <!-- Deleted-shop snapshot banner (site admins only) -->
      <div class="mb-4">
        <InlineAlert type="warning" soft title={m.admin_deleted_shops_preview_title()}>
          <p>{m.admin_deleted_shops_preview_description()}</p>
          <div class="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            {#if data.deletedPreview.deletedAt}
              <span>
                {m.admin_deleted_shops_header_time()}:
                {formatDateTime(data.deletedPreview.deletedAt)}
              </span>
            {/if}
            {#if data.deletedPreview.deletedBy}
              <span class="flex items-center gap-1.5">
                {m.admin_deleted_shops_header_admin()}:
                <UserAvatar user={data.deletedPreview.deletedBy} size="xs" showName />
              </span>
            {/if}
            {#if data.deletedPreview.deleteRequestId}
              <a
                class="link"
                href={resolve('/(main)/shops/delete-requests/[id]', {
                  id: data.deletedPreview.deleteRequestId
                })}
              >
                {m.view_delete_request()}
              </a>
            {/if}
          </div>
        </InlineAlert>
      </div>
    {/if}
    {#if isTimePointPreview && data.timePointPreview}
      <!-- Changelog time-point snapshot banner (public, admin gets rollback) -->
      <div class="mb-4">
        <InlineAlert type="warning" soft title={m.shop_time_point_preview_title()}>
          <p>{m.shop_time_point_preview_description()}</p>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-1">
            <span class="text-sm">
              {m.shop_time_point_preview_time()}:
              {formatDateTime(data.timePointPreview.entryCreatedAt)}
            </span>
            <div class="flex flex-wrap items-center gap-1">
              <a
                class="btn btn-soft btn-primary btn-xs"
                href={resolve('/(main)/shops/[id]', { id: String(shop.id) })}
              >
                <i class="fa-solid fa-arrow-left"></i>
                {m.shop_time_point_back_to_current()}
              </a>
              {#if isAdmin && canProtectedShopAction}
                <button
                  class="btn btn-error btn-xs btn-soft"
                  onclick={() => (showRollbackDialog = true)}
                >
                  <i class="fa-solid fa-rotate-left"></i>
                  {m.shop_time_point_rollback()}
                </button>
              {/if}
            </div>
          </div>
        </InlineAlert>
      </div>
    {/if}
    <div class="md:grid md:grid-cols-5 md:gap-8 lg:grid-cols-3">
      {#snippet renderAttendanceActions(klass = 'w-full')}
        <ShopAttendanceActions
          bind:this={attendanceActions}
          class={klass}
          {shop}
          user={data.user}
          {now}
          {attendanceData}
          {reportedAttendances}
          otherAttendance={otherShop || null}
          {isShopOpen}
          {isUserNearShop}
          {distance}
          {locationError}
          {canProtectedShopAction}
          {protectedShopActionMessage}
          onChanged={getAttendanceData}
        />
      {/snippet}
      {#snippet closedAlert()}
        <InlineAlert type="error" soft title={m.shop_is_permanently_closed()}>
          {#if shop.closedReason}
            {shop.closedReason}
          {/if}
        </InlineAlert>
      {/snippet}
      {#snippet header(isMain = true)}
        {@const [link, label] = !isShopChinaBased(shop)
          ? [
              `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                `${shop.name} ${formatShopAddress(shop)}`
              )}`,
              m.view_in_google_maps()
            ]
          : [
              `https://uri.amap.com/marker?position=${shop.location.coordinates[0]},${
                shop.location.coordinates[1]
              }&name=${encodeURIComponent(shop.name)}&src=nearcade&callnative=1`,
              m.view_in_amap()
            ]}
        <!-- Shop Header -->
        <div class="mb-8 {isMain ? 'not-md:hidden' : 'md:hidden'}">
          <div class="mb-4 flex min-w-0 items-center justify-between gap-2">
            <h1 class="text-3xl font-bold wrap-break-word">
              {shop._t?.shop_name?.[pageLocale] ?? shop.name}
              {#if shop._t?.shop_name?.[pageLocale]}
                <span
                  class="badge badge-ghost badge-sm align-middle font-normal"
                  title={m.ai_translated_disclosure()}
                >
                  <i class="fa-solid fa-language text-xs"></i>
                  <span class="hidden sm:inline">{m.ai_translation_badge()}</span>
                </span>
              {/if}
              {#if shop.isClaimed}
                {#snippet badge()}
                  <span class="badge badge-success badge-soft">
                    <i class="fa-solid fa-check-circle"></i>
                    <span class="text-sm">{m.claimed()}</span>
                  </span>
                {/snippet}
                <div
                  class="tooltip tooltip-right text-base-content/60 font-normal not-md:hidden"
                  data-tip={m.claimed_description()}
                >
                  {@render badge()}
                </div>
                <div class="md:hidden" title={m.claimed_description()}>
                  {@render badge()}
                </div>
              {/if}
              {#if shop.isLocked}
                {#snippet lockBadge()}
                  <span class="badge badge-warning badge-soft">
                    <i class="fa-solid fa-lock"></i>
                    <span class="text-sm">{m.shop_locked()}</span>
                  </span>
                {/snippet}
                <div
                  class="tooltip tooltip-right text-base-content/60 font-normal not-md:hidden"
                  data-tip={m.shop_locked_description()}
                >
                  {@render lockBadge()}
                </div>
                <div class="md:hidden" title={m.shop_locked_description()}>
                  {@render lockBadge()}
                </div>
              {/if}
            </h1>
            <span class="text-base-content/60 text-right not-md:hidden">
              #{shop.id}
            </span>
            {#if !isPreview}
              {@render renderAttendanceActions('max-w-[40vw] min-w-24 tooltip-left md:hidden')}
            {/if}
          </div>

          <div
            class="alert alert-success alert-soft flex flex-col items-start gap-2 text-[1.03125rem] leading-normal"
          >
            <div class="flex min-w-0 items-start gap-2">
              <div class="w-4 text-center">
                <i class="fa-solid fa-location-dot mt-0.75 shrink-0"></i>
              </div>
              <span class="wrap-break-word whitespace-pre-line"
                >{formatShopAddress(shop, true)}</span
              >
            </div>
          </div>

          {#if shopComment.content}
            <div class="text-base-content/80 mt-4">
              <p
                class="prose-md h-auto flex-1 overflow-auto wrap-break-word"
                class:prose={shopComment.rendered}
              >
                {#if shopComment.rendered}
                  {@html shopComment.content}
                {:else}
                  {shopComment.content}
                {/if}
              </p>
            </div>
          {/if}

          <section class="mt-6">
            <PhotoCarousel
              shopId={shop.id}
              bind:photos
              currentUser={data.user}
              canUpload={canProtectedShopAction && !isPreview}
              canManagePhotos={canProtectedShopAction && !isPreview}
              showUploadButton={!isPreview}
              showViewAllLink={!isPreview}
              disabledActionReason={protectedShopActionMessage}
              onBlockedAction={isPhoneRequired ? phoneRequiredToast : undefined}
            />
          </section>

          <div class="mt-6 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <a
                href="{resolve('/(main)/discover')}?longitude={shop.location
                  ?.coordinates[0]}&latitude={shop.location
                  ?.coordinates[1]}&name={shop.name}&radius={radius}"
                target={adaptiveNewTab()}
                class="btn btn-accent btn-soft"
              >
                <i class="fa-solid fa-map-location-dot"></i>
                {m.explore_nearby()}
              </a>
              {#if data.user && !isPreview}
                <StarShopButton shopId={shop.id} user={data.user} />
              {/if}
            </div>

            <div class="flex flex-wrap items-center gap-2">
              {#if data.user && !isPreview}
                <ShopActionsMenu
                  {shop}
                  user={data.user}
                  {canProtectedShopAction}
                  {protectedShopActionMessage}
                  {isPhoneRequired}
                  hasPendingDeleteRequest={!!pendingDeleteRequest}
                  onRequestDelete={() => (showDeleteRequestModal = true)}
                />
              {/if}
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-primary btn-soft"
              >
                <i class="fa-solid fa-external-link-alt"></i>
                {label}
              </a>
            </div>
          </div>
        </div>
      {/snippet}

      {#if shop.isClosed}
        <div class="mb-4 md:hidden">
          {@render closedAlert()}
        </div>
      {/if}

      {@render header(false)}

      <!-- Sidebar -->
      <div class="order-1 not-md:mb-6 md:col-span-2 lg:col-span-1">
        <div class="sticky top-20 space-y-6">
          {#if shop.isClosed}
            <div class="not-md:hidden">
              {@render closedAlert()}
            </div>
          {/if}
          <!-- Shop Information -->
          <div class="card bg-base-200">
            <div class="card-body p-6">
              <h3 class="mb-2 text-lg font-semibold">{m.shop_info()}</h3>

              <div class="space-y-2">
                {#if shop.createdAt}
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-base-content/60 truncate">{m.created()}</span>
                    <span class="text-right font-semibold"
                      >{formatDistanceToNow(shop.createdAt, {
                        addSuffix: true,
                        locale: getFnsLocale(getLocale())
                      })}</span
                    >
                  </div>
                {/if}

                <div class="flex items-center justify-between gap-1">
                  <span class="text-base-content/60 truncate">{m.updated()}</span>
                  <span class="text-right font-semibold"
                    >{formatDistanceToNow(shop.updatedAt, {
                      addSuffix: true,
                      locale: getFnsLocale(getLocale())
                    })}</span
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- Shop Owner (only for claimed shops with an owner) -->
          {#if shop.isClaimed && shopOwner}
            <div class="card bg-base-200">
              <div class="card-body p-6">
                <h3 class="mb-3 text-lg font-semibold">{m.shop_owner()}</h3>
                <UserAvatar user={shopOwner} showName size="sm" />
              </div>
            </div>
          {/if}

          <!-- Opening Hours -->
          {#if openingHours && shop.openingHours.length > 0}
            <div class="card bg-base-200">
              <div class="card-body p-6">
                <div class="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 class="text-lg font-semibold">{m.opening_hours()}</h3>
                    <p class="text-base-content/60 text-xs">
                      UTC{showOpeningHoursInUserTime ? getUserOffset() : getShopOffset()}
                    </p>
                  </div>
                  <label
                    class="flex cursor-pointer items-center gap-2 text-right"
                    title={showOpeningHoursInUserTime ? m.local_time() : m.my_location()}
                  >
                    <span class="text-xs whitespace-nowrap opacity-70">
                      {showOpeningHoursInUserTime ? m.my_location() : m.local_time()}
                    </span>
                    <input
                      type="checkbox"
                      class="toggle toggle-sm"
                      bind:checked={showOpeningHoursInUserTime}
                    />
                  </label>
                </div>

                <div class="space-y-2">
                  {#if shop.openingHours.length === 7}
                    {#each shop.openingHours as hours, idx (idx)}
                      <div class="flex items-center justify-between gap-3 text-sm">
                        <span class="text-base-content/60 truncate font-medium"
                          >{DAY_LABELS()[idx]}</span
                        >
                        <span class="text-right font-semibold">
                          {showOpeningHoursInUserTime
                            ? formatUserOpeningHourPair(hours, idx)
                            : formatShopOpeningHourPair(hours)}
                        </span>
                      </div>
                    {/each}
                  {:else}
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-base-content/60 truncate">
                        {showOpeningHoursInUserTime ? m.my_location() : m.local_time()}
                      </span>
                      <span class="text-right font-semibold">
                        {showOpeningHoursInUserTime
                          ? formatUserSingleOpeningHourPair(openingHours.open, openingHours.close)
                          : formatShopOpeningHourPair(shop.openingHours[0])}
                      </span>
                    </div>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          <!-- Shop Statistics -->
          <div class="card bg-base-200 not-md:hidden">
            <div class="card-body p-6">
              <h3 class="mb-2 text-lg font-semibold">{m.shop_statistics()}</h3>

              <div class="space-y-2">
                <div class="flex items-center justify-between gap-1">
                  <span class="text-base-content/60 truncate">{m.total_games()}</span>
                  <span class="text-right font-semibold">{shop.games.length}</span>
                </div>

                <div class="flex items-center justify-between gap-1">
                  <span class="text-base-content/60 truncate">{m.total_machines()}</span>
                  <span class="text-right font-semibold"
                    >{shop.games.reduce((total, game) => total + game.quantity, 0)}</span
                  >
                </div>
              </div>
            </div>
          </div>

          <!-- Attendance -->
          <div class="card bg-base-200">
            <div class="card-body p-6">
              <h3 class="mb-4 text-lg font-semibold">{m.attendance()}</h3>

              <div class="py-4 text-center">
                {#if shop.isClaimed}
                  <!-- For claimed shops, show queue-based attendance -->
                  <div class="text-primary mb-2 text-3xl font-bold">{displayTotalAttendance}</div>
                {:else if attendanceReport.length > 0}
                  {@const reportedAttendance = {
                    reportedBy: attendanceReport[0].reporter,
                    reportedAt: attendanceReport[0].reportedAt,
                    comment: attendanceReport[0].comment
                  }}
                  <AttendanceReportBlame {reportedAttendance}>
                    <div class="text-accent mb-2 text-3xl font-bold">
                      {totalAttendance}
                    </div>
                  </AttendanceReportBlame>
                {:else}
                  <div class="text-primary mb-2 text-3xl font-bold">{totalAttendance}</div>
                {/if}
                <div class="text-base-content/60 text-sm">{m.players_currently_playing()}</div>
              </div>

              {#if shop.games.length > 0}
                {@const aggregatedGames = aggregateGames(shop)}
                <div class="space-y-2 text-sm">
                  {#each aggregatedGames as game (game.titleId)}
                    {@const gameInfo = getGameInfo(game.titleId)}
                    {@const positions =
                      game.quantity * (GAME_TITLES.find((g) => g.id === game.titleId)?.seats || 1)}
                    {#if shop.isClaimed}
                      <!-- For claimed shops, show queue-based per-game attendance -->
                      {@const queueGameAttendance = shop.games.reduce(
                        (total, g) =>
                          g.titleId === game.titleId
                            ? total + getQueueGameAttendance(g.gameId)
                            : total,
                        0
                      )}
                      <div class="flex items-center justify-between gap-1">
                        <span class="text-base-content/60 truncate">
                          {getGameName(gameInfo?.key) || game.name}
                        </span>
                        <span class="font-medium" class:text-primary={queueGameAttendance > 0}>
                          {queueGameAttendance} / {positions}
                        </span>
                      </div>
                    {:else}
                      <!-- For regular shops, show attendance/reported data -->
                      {@const gameAttendance = shop.games.reduce(
                        (total, g) =>
                          g.titleId === game.titleId ? total + getGameAttendance(g.gameId) : total,
                        0
                      )}
                      {@const reportedAttendance = reportedAttendances
                        .reduce(
                          (acc, cur) => {
                            if (
                              shop.games.find((g) => g.gameId === cur.id)?.titleId === game.titleId
                            ) {
                              acc.push(cur);
                            }
                            return acc;
                          },
                          [] as typeof reportedAttendances
                        )
                        .reduce(
                          (mostRecent, current) =>
                            !mostRecent ||
                            new Date(current.reportedAt) > new Date(mostRecent.reportedAt)
                              ? {
                                  ...current,
                                  count: (current.count || 0) + (mostRecent?.count || 0)
                                }
                              : mostRecent,
                          undefined as (typeof reportedAttendances)[number] | undefined
                        )}
                      <div class="flex items-center justify-between gap-1">
                        <span class="text-base-content/60 truncate">
                          {getGameName(gameInfo?.key) || game.name}
                        </span>
                        {#if reportedAttendance}
                          <AttendanceReportBlame {reportedAttendance} class="tooltip-left">
                            <span class="text-accent font-medium">
                              {reportedAttendance.count || 0} / {positions}
                            </span>
                          </AttendanceReportBlame>
                        {:else}
                          <span class="font-medium" class:text-primary={gameAttendance > 0}>
                            {gameAttendance} / {positions}
                          </span>
                        {/if}
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}

              <!-- Attend button -->
              {#if data.user && !isPreview}
                <div class="border-base-content/10 mt-4 border-t pt-4">
                  {@render renderAttendanceActions()}
                </div>
              {/if}
            </div>
          </div>

          <!-- Pending Delete Request -->
          {#if pendingDeleteRequest}
            <PendingDeleteRequestCard
              request={pendingDeleteRequest}
              user={data.user}
              {canProtectedShopAction}
              {protectedShopActionMessage}
            />
          {/if}

          <!-- Attendance Reports -->
          {#if !shop.isClaimed}
            <AttendanceReports shopId={shop.id} gamesList={GAME_TITLES} />
          {/if}
        </div>
      </div>

      <!-- Main Content -->
      <div class="md:col-span-3 lg:col-span-2">
        {@render header()}

        <!-- Games Section -->
        {#if shop.games.length > 0}
          <div class="flex flex-col gap-4">
            {#each shop.games as game, i (i)}
              {@const gameInfo = getGameInfo(game.titleId)}
              {@const countedAttendance = getGameAttendance(game.gameId)}
              {@const reportedAttendance = reportedAttendances.find((g) => g.id === game.gameId)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="card bg-base-200 group hover:border-primary border-2 border-current/0 shadow-none transition-all hover:shadow-lg"
                onmouseenter={() => (hovered[game.gameId] = true)}
                onmouseleave={() => (hovered[game.gameId] = false)}
              >
                <div class="card-body p-6">
                  <div class="flex items-center justify-between gap-2">
                    <h3 class="truncate text-xl font-semibold">
                      <T
                        text={game.name}
                        field="game_name"
                        translation={game._t?.game_name?.[pageLocale]}
                      />
                    </h3>
                    <div class="flex items-center gap-1">
                      {#if data.user && !shop.isClaimed && !isPreview}
                        {#if canProtectedShopAction && isShopOpen && isUserNearShop}
                          <FancyButton
                            callback={() =>
                              attendanceActions?.openReport({
                                id: game.gameId,
                                name: game.name,
                                version: game.version
                              })}
                            class="fa-solid fa-chart-simple"
                            btnCls="hover:btn-neutral btn-soft btn-sm text-sm"
                            text={m.report_current_attendance()}
                            expanded={hovered[game.gameId] || false}
                            override
                          />
                        {:else if !canProtectedShopAction}
                          <div class="tooltip tooltip-left" data-tip={protectedShopActionMessage}>
                            <button
                              class="btn btn-soft btn-sm text-sm"
                              disabled
                              aria-label={m.report_current_attendance()}
                              title={m.report_current_attendance()}
                            >
                              <i class="fa-solid fa-chart-simple"></i>
                              <span class="sr-only">{m.report_current_attendance()}</span>
                            </button>
                          </div>
                        {/if}
                      {/if}
                      <div
                        class="btn btn-neutral btn-active btn-soft btn-sm cursor-default text-base"
                      >
                        ×{game.quantity}
                      </div>
                    </div>
                  </div>

                  <div class="space-y-2 text-sm">
                    <div
                      class="group-hover:text-accent flex items-center gap-2 transition-colors"
                      use:adaptiveIcon
                    >
                      <i class="fa-solid fa-gamepad"></i>
                      {#if game.version}
                        <span>
                          {getGameName(gameInfo?.key) || game.name} ·
                          <T
                            text={game.version}
                            field="game_version"
                            translation={game._t?.game_version?.[pageLocale]}
                          />
                        </span>
                      {:else}
                        <span>{getGameName(gameInfo?.key) || game.name}</span>
                      {/if}
                    </div>
                    {#if costs[game.gameId]}
                      <div
                        class="group-hover:text-warning flex items-center gap-2 transition-colors"
                        use:adaptiveIcon
                      >
                        <i class="fa-solid fa-coins"></i>
                        {@html costs[game.gameId]}
                      </div>
                    {/if}
                    {#if gameComments[game.gameId]}
                      <div class="flex items-center gap-2 whitespace-pre-line" use:adaptiveIcon>
                        <i class="fa-solid fa-circle-info"></i>
                        <div
                          class="prose prose-sm flex h-auto flex-1 flex-col gap-2 overflow-auto *:my-0"
                        >
                          {@html gameComments[game.gameId]}
                        </div>
                      </div>
                    {/if}
                  </div>

                  <!-- Queue/Attendance Section -->
                  <div class="border-base-content/10 mt-4 border-t pt-4">
                    {#if shop.isClaimed}
                      <!-- Queue display for claimed shops -->
                      {@const gameQueue = getGameQueue(game.gameId)}
                      {#if gameQueue && gameQueue.queue.length > 0}
                        {@const playingCount = gameQueue.queue.reduce(
                          (sum, p) => sum + p.members.length,
                          0
                        )}
                        <div class="flex items-center justify-between">
                          <span class="text-base-content/60 text-sm">{m.queue()}</span>
                          <span class="text-sm font-medium"
                            >{m.in_attendance({ count: playingCount })}</span
                          >
                        </div>
                        <div class="mt-3 flex flex-wrap gap-2">
                          {#each gameQueue.queue as position (position.members
                            .map((m) => m.slotIndex)
                            .join('-'))}
                            <div
                              class="tooltip relative h-15 rounded-lg border-2 px-4 py-2 {getPositionClass(
                                position.status,
                                position.isPublic ?? true
                              )}"
                              animate:flip={{ duration: 200 }}
                              transition:fade={{ duration: 200 }}
                            >
                              <div class="tooltip-content px-3 whitespace-nowrap">
                                #{position.position} · {getStatusLabel(position.status)}
                              </div>
                              <!-- Private indicator (lock icon in purple triangle) -->
                              {#if !(position.isPublic ?? true)}
                                <div
                                  class="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center overflow-hidden rounded-tr-lg rounded-bl-lg {position.status ===
                                  'playing'
                                    ? 'bg-orange-500'
                                    : position.status === 'queued'
                                      ? 'bg-violet-500'
                                      : 'bg-gray-500'}"
                                >
                                  <i class="fa-solid fa-lock text-[10px] text-white"></i>
                                </div>
                              {/if}
                              <div class="flex h-full flex-1 items-center justify-center gap-2">
                                {#each position.members as member, i (i)}
                                  {#if i > 0}
                                    <div class="divider divider-horizontal mx-0"></div>
                                  {/if}
                                  {#if member.user}
                                    <div class="max-w-fit">
                                      <UserAvatar
                                        user={member.user}
                                        size="xs"
                                        showName
                                        target={adaptiveNewTab()}
                                      />
                                    </div>
                                  {:else}
                                    <span class="text-lg font-bold">
                                      {member.slotIndex}
                                    </span>
                                  {/if}
                                {/each}
                              </div>
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <div class="flex items-center justify-between">
                          <span class="text-base-content/60 text-sm">{m.queue()}</span>
                          <span class="text-base-content/60 text-sm">{m.no_queue_data()}</span>
                        </div>
                      {/if}
                    {:else}
                      <!-- Standard attendance display for unclaimed shops -->
                      <div class="flex items-center justify-between">
                        <span class="text-base-content/60 text-sm"
                          >{m.current_players()} ({countedAttendance})</span
                        >
                        {#if reportedAttendance !== undefined}
                          <AttendanceReportBlame {reportedAttendance} class="not-md:tooltip-left">
                            <span class="text-accent text-sm font-medium">
                              {m.in_attendance({ count: reportedAttendance?.count || 0 })}
                            </span>
                          </AttendanceReportBlame>
                        {:else}
                          <span class="text-sm font-medium">
                            {m.in_attendance({ count: countedAttendance })}
                          </span>
                        {/if}
                      </div>

                      <!-- Detailed attendance list for this game -->
                      {#if attendanceData}
                        {@const attendees = attendanceData.filter(
                          (attendee) => attendee.gameId === game.gameId
                        )}
                        {#if attendees.length > 0}
                          <div class="border-base-content/10 mt-3">
                            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {#each attendees as attendee (attendee.userId)}
                                <div class="tooltip w-fit">
                                  <div class="tooltip-content px-3 whitespace-pre-line">
                                    {m.attendance_details({
                                      duration: formatDistanceToNow(attendee.attendedAt, {
                                        locale: getFnsLocale(getLocale())
                                      }),
                                      leave: formatTime(attendee.plannedLeaveAt)
                                    })}
                                  </div>
                                  <div class="w-fit">
                                    <UserAvatar
                                      user={attendee.user || { displayName: attendee.userId }}
                                      size="sm"
                                      showName
                                      target={adaptiveNewTab()}
                                    />
                                  </div>
                                </div>
                              {/each}
                            </div>
                          </div>
                        {/if}
                      {/if}
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="py-8 text-center">
            <div class="text-base-content/40 mb-2">
              <i class="fa-solid fa-gamepad text-4xl"></i>
            </div>
            <p class="text-base-content/60">{m.no_games_available()}</p>
          </div>
        {/if}

        <!-- Comments Section -->
        <section class="mt-8">
          <h2 class="mb-6 flex items-center gap-2 text-xl font-semibold">
            <i class="fa-solid fa-comments"></i>
            {m.comments()} ({comments.length})
          </h2>

          <!-- Add comment form -->
          {#if !isPreview}
            {#if canComment}
              <div class="bg-base-100 mb-6 rounded-xl p-4">
                <CommentComposer
                  shopId={shop.id}
                  currentUser={data.user}
                  onSubmitted={invalidateAll}
                />
              </div>
            {:else}
              <VerifiedContactPrompt
                user={data.user}
                loginMessage={m.login_to_comment()}
                icon="fa-comment"
                compact
                class="mb-6"
              />
            {/if}
          {/if}

          <!-- Comments list -->
          {#if comments.length > 0}
            <div class="space-y-1">
              {#each comments.filter((c) => !c.parentCommentId) as comment (comment.id)}
                <div>
                  <Comment
                    {comment}
                    currentUserId={canInteractComments ? data.user?.id : undefined}
                    currentUser={canInteractComments ? data.user : undefined}
                    canReply={canInteractComments}
                    canEdit={false}
                    onVote={canInteractComments ? handleCommentVote : undefined}
                    onReply={canInteractComments ? handleCommentReply : undefined}
                    onEdit={canInteractComments ? handleCommentEdit : undefined}
                    onDelete={canInteractComments ? handleCommentDelete : undefined}
                    isPostRendered={isCommentsRendered}
                    depth={0}
                  />

                  <!-- Reply form -->
                  {#if replyingTo === comment.id && canInteractComments}
                    <div class="bg-base-200 mt-2 ml-8 rounded-xl p-4">
                      <CommentComposer
                        shopId={shop.id}
                        currentUser={data.user}
                        parentCommentId={comment.id}
                        placeholder={m.reply_to_comment()}
                        submitLabel={m.reply()}
                        onCancel={() => (replyingTo = null)}
                        onSubmitted={() => {
                          replyingTo = null;
                          invalidateAll();
                        }}
                      />
                    </div>
                  {/if}

                  <!-- Nested replies -->
                  {#each comments.filter((c) => c.parentCommentId === comment.id) as reply (reply.id)}
                    <Comment
                      comment={reply}
                      currentUserId={canInteractComments ? data.user?.id : undefined}
                      currentUser={canInteractComments ? data.user : undefined}
                      canReply={canInteractComments}
                      canEdit={false}
                      onVote={canInteractComments ? handleCommentVote : undefined}
                      onReply={canInteractComments ? handleCommentReply : undefined}
                      onEdit={canInteractComments ? handleCommentEdit : undefined}
                      onDelete={canInteractComments ? handleCommentDelete : undefined}
                      isPostRendered={isCommentsRendered}
                      depth={1}
                    />
                  {/each}
                </div>
              {/each}
            </div>
          {:else}
            <div class="bg-base-100 rounded-xl p-8 text-center">
              <i class="fa-solid fa-comments text-base-content/30 mb-4 text-4xl"></i>
              <h3 class="mb-2 text-lg font-medium">{m.no_comments_yet()}</h3>
              {#if data.user}
                <p class="text-base-content/60">{m.be_first_to_comment()}</p>
              {:else}
                <p class="text-base-content/60">{m.login_to_comment()}</p>
              {/if}
            </div>
          {/if}
        </section>

        <!-- Changelog Section -->
        {#if shop}
          <section class="mt-8">
            <details class="group" open={isChangelogOpen}>
              <summary
                class="hover:bg-base-200 flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2 transition-colors"
              >
                <i
                  class="fa-solid fa-clock-rotate-left text-base-content/60 transition-transform group-open:rotate-90"
                ></i>
                <h2 class="text-xl font-semibold">{m.changelog()}</h2>
                <i
                  class="fa-solid fa-chevron-right text-base-content/40 ml-auto text-xs transition-transform group-open:rotate-90"
                ></i>
              </summary>
              <div class="mt-4">
                <!-- Keyed on the shop revision: a rollback navigates back to the
                live page via `goto`, which is a same-route navigation — SvelteKit
                reruns the load but reuses this component, so without the key the
                changelog's onMount fetch would never re-run and the list would
                go stale. Any revision (rollback, edit) remounts and refetches. -->
                {#key shop.updatedAt}
                  <ShopChangelogView
                    shopId={shop.id}
                    isSiteAdmin={data.user?.userType === 'site_admin' &&
                      canProtectedShopAction &&
                      !isPreview}
                  />
                {/key}
              </div>
            </details>
          </section>
        {/if}
      </div>
    </div>
  </div>

  <!-- Delete Request Modal -->
  {#if !isPreview}
    <DeleteRequestModal
      bind:open={showDeleteRequestModal}
      shopId={shop.id}
      user={data.user}
      onSubmitted={invalidateAll}
    />
  {/if}

  <!-- Admin rollback from a time-point preview -->
  {#if isTimePointPreview && data.timePointPreview}
    <ShopRollbackDialog
      bind:open={showRollbackDialog}
      shopId={shop.id}
      targetEntryId={data.timePointPreview.entryId}
      authors={data.timePointPreview.authors}
      photoCount={data.timePointPreview.photoCount}
      onApplied={() => goto(resolve('/(main)/shops/[id]', { id: String(shop.id) }))}
    />
  {/if}
{/if}
