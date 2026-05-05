<script lang="ts">
  /* eslint svelte/no-at-html-tags: "off" */
  import { m } from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  import {
    adaptiveNewTab,
    aggregateGames,
    calculateDistance,
    convertCoordinates,
    formatDistance,
    formatHourLiteral,
    formatOpeningHourLiteral,
    formatShopAddress,
    formatTime,
    getFnsLocale,
    getGameName,
    getMyLocation,
    getShopTimezone,
    getShopOpeningHours,
    isShopChinaBased,
    pageTitle,
    sanitizeHTML
  } from '$lib/utils';
  import { ATTENDANCE_RADIUS_KM, GAMES } from '$lib/constants';
  import { getContext } from 'svelte';
  import type { AMapContext, QueueRecord, QueuePosition, QueueMember } from '$lib/types';
  import AttendanceModal from '$lib/components/AttendanceModal.svelte';
  import { browser } from '$app/environment';
  import type { AttendanceData, AttendanceReport } from '$lib/types';
  import { fromPath } from '$lib/utils/scoped';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import UserAvatar from '$lib/components/UserAvatar.svelte';
  import { formatDistanceToNow } from 'date-fns';
  import { fromZonedTime } from 'date-fns-tz';
  import { getLocale } from '$lib/paraglide/runtime';
  import FancyButton from '$lib/components/FancyButton.svelte';
  import type { User } from '$lib/auth/types';
  import AttendanceReportBlame from '$lib/components/AttendanceReportBlame.svelte';
  import { invalidateAll } from '$app/navigation';
  import AttendanceReports from '$lib/components/AttendanceReports.svelte';
  import { flip } from 'svelte/animate';
  import { fade } from 'svelte/transition';
  import Comment from '$lib/components/Comment.svelte';
  import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';
  import type { OpeningHourTime } from '$lib/types';
  import { render } from '$lib/utils/markdown';
  import PhotoCarousel from '$lib/components/PhotoCarousel.svelte';
  import type { ShopPhoto } from '$lib/types';

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

  let shop = $derived(shopDataResolved?.shop);
  let currentAttendanceFromServer = $derived(shopDataResolved?.currentAttendance);
  let pendingDeleteRequest = $derived(shopDataResolved?.pendingDeleteRequest);
  let photosFromServer = $derived(shopDataResolved?.photos ?? []);
  // eslint-disable-next-line svelte/prefer-writable-derived
  let photos = $state<ShopPhoto[]>([]);

  $effect(() => {
    photos = photosFromServer;
  });
  let attendanceData = $state<AttendanceData>([]);
  let attendanceReport = $state<AttendanceReport>([]);
  let showAttendanceModal = $state(false);
  let showReportAttendanceModal = $state(false);
  let selectedGameForReport = $state<{ id: number; name: string; version: string } | null>(null);
  let reportedAttendance = $state<number>(0);
  let reportedAttendances = $state<
    Array<{
      id: number;
      count: number | undefined;
      reportedBy: User | undefined;
      reportedAt: string;
      comment: string | null;
    }>
  >([]);
  let totalAttendance = $state(0);
  let openingHours = $derived(shop && getShopOpeningHours(shop));
  let showOpeningHoursInUserTime = $state(false);
  let now = $state(new Date());
  let isShopOpen = $derived(
    openingHours && now >= openingHours.openTolerated && now <= openingHours.closeTolerated
  );
  let otherShop = $derived.by(() => {
    if (!currentAttendanceFromServer) return false;
    const attendance = currentAttendanceFromServer;
    return shop && attendance.shop.id !== shop.id ? attendance : false;
  });
  let hovered = $state<Record<number, boolean>>({});
  let isLoading = $state(0);

  // Track user's current attendance status
  let userAttendance = $state<boolean>(false);
  let costs: Record<string, string> = $state({});

  // Queue data for claimed shops
  type EnrichedQueueMember = QueueMember & { user?: User | null };
  type EnrichedQueuePosition = Omit<QueuePosition, 'members'> & { members: EnrichedQueueMember[] };
  type EnrichedQueueRecord = Omit<QueueRecord['games'][number], 'queue'> & {
    queue: EnrichedQueuePosition[];
  };
  let queueData = $state<EnrichedQueueRecord[]>([]);

  // Update user attendance status
  $effect(() => {
    if (data.user && attendanceData) {
      userAttendance = attendanceData.some((attendee) => attendee.userId === data.user?.id);
    }
  });

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
      // For claimed shops, fetch queue data; otherwise fetch attendance data
      if (shop.isClaimed) {
        getQueueData();
      } else {
        getAttendanceData();
      }
      render(shop.comment).then((content) => {
        shopComment = { rendered: true, content };
      });

      Promise.all(
        shop.games.map(async (game) => {
          gameComments[game.gameId] = await render(game.comment);
          costs[game.gameId] = await sanitizeHTML(game.cost);
        })
      );

      // Check user location proximity to shop
      checkUserProximity();
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
    return GAMES.find((g) => g.id === titleId);
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

  const normalizeOpeningHourTime = (time: OpeningHourTime | number): OpeningHourTime => {
    if (typeof time === 'number') {
      const normalized = ((time % 24) + 24) % 24 || 0;
      let hour = Math.floor(normalized);
      let minute = Math.round((normalized - hour) * 60);
      if (minute === 60) {
        minute = 0;
        hour = (hour + 1) % 24;
      }
      return { hour, minute };
    }

    return {
      hour: Math.max(0, Math.min(23, Math.floor(Number(time?.hour) || 0))),
      minute: Math.max(0, Math.min(59, Math.floor(Number(time?.minute) || 0)))
    };
  };

  const getOpeningHourTotalMinutes = (time: OpeningHourTime | number) => {
    const normalized = normalizeOpeningHourTime(time);
    return normalized.hour * 60 + normalized.minute;
  };

  const formatShopOpeningHourPair = (pair: [OpeningHourTime | number, OpeningHourTime | number]) =>
    `${formatOpeningHourLiteral(pair[0])} – ${formatOpeningHourLiteral(pair[1])}`;

  const padTimePart = (value: number) => String(value).padStart(2, '0');

  const makeZonedDate = (
    timeZone: string,
    dateParts: { year: number; month: number; day: number },
    time: OpeningHourTime | number
  ) => {
    const normalized = normalizeOpeningHourTime(time);
    return fromZonedTime(
      `${dateParts.year}-${padTimePart(dateParts.month)}-${padTimePart(dateParts.day)}T${padTimePart(
        normalized.hour
      )}:${padTimePart(normalized.minute)}:00`,
      timeZone
    );
  };

  const getShopWeekDateParts = (weekdayIndex: number) => {
    if (!shop) return undefined;
    const timeZone = getShopTimezone(shop.location);
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

  const formatUserOpeningHourPair = (
    pair: [OpeningHourTime | number, OpeningHourTime | number],
    weekdayIndex: number
  ) => {
    const dateParts = getShopWeekDateParts(weekdayIndex);
    if (!dateParts) return formatShopOpeningHourPair(pair);

    const open = makeZonedDate(dateParts.timeZone, dateParts, pair[0]);
    const closesNextShopDay =
      getOpeningHourTotalMinutes(pair[1]) <= getOpeningHourTotalMinutes(pair[0]);
    const closeDateParts = closesNextShopDay
      ? (() => {
          const date = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + 1));
          return {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate()
          };
        })()
      : dateParts;
    const close = makeZonedDate(dateParts.timeZone, closeDateParts, pair[1]);
    const expectedOpenDay = (weekdayIndex + 1) % 7;
    const expectedCloseDay = (expectedOpenDay + (closesNextShopDay ? 1 : 0)) % 7;
    const showOpenDay = open.getDay() !== expectedOpenDay;
    const showCloseDay = close.getDay() !== expectedCloseDay || showOpenDay;
    const labels = JS_DAY_LABELS();
    const openLabel = `${showOpenDay ? `${labels[open.getDay()]} ` : ''}${formatTime(open)}`;
    const closeLabel = `${showCloseDay ? `${labels[close.getDay()]} ` : ''}${formatTime(close)}`;

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

  const handleAttend = async (games: number[], plannedLeaveAt: Date) => {
    if (!data.user || !shop) return;

    isLoading = 1;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.id}/attendance`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          games: games.map((id) => ({ id })),
          plannedLeaveAt: plannedLeaveAt.toISOString()
        })
      });

      if (!response.ok) {
        throw new Error('Failed to attend');
      }

      await getAttendanceData();
    } catch (error) {
      console.error('Error attending:', error);
      // TODO: Show error toast
    } finally {
      isLoading = 0;
    }
  };

  const handleLeave = async () => {
    if (!data.user || !shop) return;

    isLoading = 1;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.id}/attendance`), {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to leave');
      }

      await getAttendanceData();
    } catch (error) {
      console.error('Error leaving:', error);
      // TODO: Show error toast
    } finally {
      isLoading = 0;
    }
  };

  const handleReportAttendance = async () => {
    if (!data.user || !selectedGameForReport || !shop) return;

    isLoading = 2;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.id}/attendance`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          games: [
            {
              id: selectedGameForReport.id,
              currentAttendances: reportedAttendance
            }
          ]
        })
      });

      if (response.ok) {
        await getAttendanceData();
        showReportAttendanceModal = false;
        selectedGameForReport = null;
        reportedAttendance = 0;
      }
    } catch (err) {
      console.error('Error reporting attendance:', err);
    } finally {
      isLoading = 0;
    }
  };

  const openReportModal = (game: { id: number; name: string; version: string }) => {
    selectedGameForReport = game;
    reportedAttendance = reportedAttendances.find((g) => g.id === game.id)?.count || 0;
    showReportAttendanceModal = true;
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
    if (!browser) return;

    const interval = setInterval(shop?.isClaimed ? getQueueData : getAttendanceData, 30000);
    return () => clearInterval(interval);
  });

  // Comment section state
  let comments = $derived(shopDataResolved?.comments ?? []);
  let newCommentContent = $state('');
  let isSubmittingComment = $state(false);
  let commentError = $state('');
  let replyingTo = $state<string | null>(null);
  let replyContent = $state('');
  let isSubmittingReply = $state(false);
  let isCommentsRendered = $state(false);

  // Delete request state
  let showDeleteRequestModal = $state(false);
  let deleteRequestReason = $state('');
  let isSubmittingDeleteRequest = $state(false);
  let deleteRequestError = $state('');
  let deleteRequestSuccess = $state('');
  let deleteRequestReviewNote = $state('');
  let isProcessingDeleteRequest = $state(false);
  let deleteRequestProcessError = $state('');

  onMount(() => {
    isCommentsRendered = true;
  });

  const handleCommentSubmit = async () => {
    if (!data.user || !shop || !newCommentContent.trim() || isSubmittingComment) return;

    isSubmittingComment = true;
    commentError = '';

    try {
      const response = await fetch(fromPath(`/api/shops/${shop.id}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newCommentContent.trim() })
      });

      if (response.ok) {
        newCommentContent = '';
        invalidateAll();
      } else {
        const errorData = (await response.json()) as { message: string };
        commentError = errorData.message || m.failed_to_post_comment();
      }
    } catch {
      commentError = m.network_error_try_again();
    } finally {
      isSubmittingComment = false;
    }
  };

  const handleCommentVote = async (commentId: string, voteType: 'upvote' | 'downvote') => {
    if (!data.user) return;

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
    replyingTo = commentId;
    replyContent = '';
  };

  const submitReply = async () => {
    if (!data.user || !shop || !replyContent.trim() || !replyingTo || isSubmittingReply) return;

    isSubmittingReply = true;
    commentError = '';

    try {
      const response = await fetch(fromPath(`/api/shops/${shop.id}/comments`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: replyContent.trim(),
          parentCommentId: replyingTo
        })
      });

      if (response.ok) {
        replyingTo = null;
        replyContent = '';
        invalidateAll();
      } else {
        const errorData = (await response.json()) as { message: string };
        commentError = errorData.message || m.failed_to_post_comment();
      }
    } catch {
      commentError = m.network_error_try_again();
    } finally {
      isSubmittingReply = false;
    }
  };

  const handleCommentEdit = async (commentId: string, newContent: string) => {
    if (!data.user) return;

    try {
      const response = await fetch(fromPath(`/api/comments/${commentId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent })
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
    if (!data.user) return;

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

  const handleSubmitDeleteRequest = async () => {
    if (!shop || !deleteRequestReason.trim() || isSubmittingDeleteRequest) return;
    isSubmittingDeleteRequest = true;
    deleteRequestError = '';
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.id}/delete-request`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: deleteRequestReason.trim() })
      });
      if (response.ok) {
        deleteRequestSuccess = m.shop_delete_request_submitted();
        deleteRequestReason = '';
        showDeleteRequestModal = false;
        invalidateAll();
      } else {
        const err = (await response.json()) as { message?: string };
        deleteRequestError = err.message || m.error_occurred();
      }
    } catch {
      deleteRequestError = m.network_error_try_again();
    } finally {
      isSubmittingDeleteRequest = false;
    }
  };

  const handleRetractDeleteRequest = async () => {
    if (!pendingDeleteRequest || isProcessingDeleteRequest) return;
    if (!confirm(m.retract_delete_request_confirm())) return;
    isProcessingDeleteRequest = true;
    deleteRequestProcessError = '';
    try {
      const response = await fetch(
        fromPath(`/api/shops/delete-requests/${pendingDeleteRequest.id}`),
        { method: 'DELETE' }
      );
      if (response.ok) {
        invalidateAll();
      } else {
        const err = (await response.json()) as { message?: string };
        deleteRequestProcessError = err.message || m.error_occurred();
      }
    } catch {
      deleteRequestProcessError = m.network_error_try_again();
    } finally {
      isProcessingDeleteRequest = false;
    }
  };

  const handleProcessDeleteRequest = async (action: 'approve' | 'reject') => {
    if (!pendingDeleteRequest || isProcessingDeleteRequest) return;
    isProcessingDeleteRequest = true;
    deleteRequestProcessError = '';
    try {
      const response = await fetch(
        fromPath(`/api/shops/delete-requests/${pendingDeleteRequest.id}`),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, reviewNote: deleteRequestReviewNote.trim() || null })
        }
      );
      if (response.ok) {
        deleteRequestReviewNote = '';
        invalidateAll();
      } else {
        const err = (await response.json()) as { message?: string };
        deleteRequestProcessError = err.message || m.error_occurred();
      }
    } catch {
      deleteRequestProcessError = m.network_error_try_again();
    } finally {
      isProcessingDeleteRequest = false;
    }
  };
</script>

<svelte:head>
  {#if shop}
    <title>{pageTitle(shop.name, m.shop_details())}</title>
    <meta name="description" content={`${shop.name} - ${formatShopAddress(shop)}`} />
    <meta property="og:title" content={pageTitle(shop.name, m.shop_details())} />
    <meta property="og:description" content={`${shop.name} - ${formatShopAddress(shop)}`} />
    <meta name="twitter:title" content={pageTitle(shop.name, m.shop_details())} />
    <meta name="twitter:description" content={`${shop.name} - ${formatShopAddress(shop)}`} />
  {:else}
    <title>{pageTitle(m.shop_details())}</title>
  {/if}
</svelte:head>

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
    <div class="md:grid md:grid-cols-5 md:gap-8 lg:grid-cols-3">
      {#snippet attend(klass = 'w-full')}
        {#if userAttendance}
          <button
            class="btn btn-error btn-soft {klass}"
            onclick={() => handleLeave()}
            disabled={isLoading === 1}
          >
            {#if isLoading === 1}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              <i class="fa-solid fa-stop"></i>
            {/if}
            {m.leave()}
          </button>
        {:else}
          <div
            class="tooltip-error {klass}"
            class:tooltip={!isShopOpen || shop.isClaimed || !!otherShop || isUserNearShop === false}
            data-tip={isShopOpen
              ? otherShop
                ? m.attending_other_shop({
                    shopName: otherShop.shop.name,
                    attendedAt: formatTime(otherShop.attendedAt)
                  })
                : shop.isClaimed
                  ? m.attend_claimed()
                  : isUserNearShop === false && distance
                    ? locationError || m.not_near_shop({ distance: formatDistance(distance, 2) })
                    : ''
              : m.shop_closed()}
          >
            <button
              class="btn btn-primary w-full"
              onclick={() => (showAttendanceModal = true)}
              disabled={!isShopOpen ||
                shop.isClaimed ||
                !!otherShop ||
                isLoading === 1 ||
                !isUserNearShop}
            >
              <i class="fa-solid fa-play"></i>
              {m.attend()}
            </button>
          </div>
        {/if}
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
          <div class="mb-4 flex items-center justify-between gap-2">
            <h1 class="text-3xl font-bold">
              {shop.name}
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
            </h1>
            <span class="text-base-content/60 text-right not-md:hidden">
              #{shop.id}
            </span>
            {@render attend('max-w-[40vw] min-w-24 tooltip-left md:hidden')}
          </div>

          <div
            class="alert alert-success alert-soft flex flex-col items-start gap-2 text-[1.03125rem] leading-normal"
          >
            <div class="flex items-start gap-2">
              <div class="w-4 text-center">
                <i class="fa-solid fa-location-dot mt-0.75 shrink-0"></i>
              </div>
              <span class="whitespace-pre-line">{formatShopAddress(shop, true)}</span>
            </div>
          </div>

          {#if shopComment.content}
            <div class="text-base-content/80 mt-4">
              <p class="prose-md h-auto flex-1 overflow-auto" class:prose={shopComment.rendered}>
                {#if shopComment.rendered}
                  {@html shopComment.content}
                {:else}
                  {shopComment.content}
                {/if}
              </p>
            </div>
          {/if}

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
              {#if data.user}
                {@const isStarred = data.user.starredArcades?.includes(shop.id)}
                {@const toggleStar = async () => {
                  isLoading = 3;
                  try {
                    const formData = new FormData();
                    formData.append('arcadeId', shop.id.toString());
                    const response = await fetch(
                      resolve('/(main)/settings/starred-arcades') +
                        (isStarred ? '?/removeArcade' : '?/addArcade'),
                      {
                        method: 'POST',
                        body: formData
                      }
                    );
                    if (response.ok) {
                      await invalidateAll();
                    }
                  } catch (err) {
                    console.log('Error starring arcade:', err);
                  } finally {
                    isLoading = 0;
                  }
                }}
                <button
                  class="btn btn-warning btn-soft group"
                  class:hover:btn-error={isStarred}
                  disabled={isLoading === 3}
                  onclick={toggleStar}
                >
                  <span class="loading loading-spinner loading-sm" class:hidden={isLoading !== 3}
                  ></span>
                  <span
                    class:hidden={!isStarred || isLoading === 3}
                    class:not-group-hover:hidden={isStarred}
                  >
                    <i class="fa-solid fa-trash"></i>
                  </span>
                  <span
                    class:group-hover:hidden={isStarred}
                    class:not-group-hover:hidden={!isStarred}
                    class:hidden={isLoading === 3}
                  >
                    <i class="fa-solid fa-star"></i>
                  </span>
                  <span
                    class:hidden={isStarred || isLoading === 3}
                    class:group-hover:hidden={!isStarred}
                  >
                    <i class="fa-regular fa-star"></i>
                  </span>
                  <span
                    class:not-group-hover:hidden={isStarred && isLoading !== 3}
                    class:hidden={!isStarred}
                  >
                    {m.unstar()}
                  </span>
                  <span
                    class:group-hover:hidden={isStarred}
                    class:hidden={isStarred && isLoading === 3}
                  >
                    {isStarred ? m.starred() : m.star()}
                  </span>
                </button>
              {/if}
            </div>

            <div class="flex flex-wrap items-center gap-2">
              {#if data.user}
                <!-- Three-dots dropdown for shop actions -->
                <div class="dropdown dropdown-end">
                  <button
                    type="button"
                    tabindex="0"
                    class="btn btn-circle btn-soft"
                    aria-label={m.more_actions()}
                    title={m.more_actions()}
                  >
                    <i class="fa-solid fa-ellipsis"></i>
                  </button>
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                  <ul
                    tabindex="0"
                    class="dropdown-content menu bg-base-200 rounded-box z-10 w-52 p-2 shadow"
                  >
                    <li>
                      <a href={resolve('/(main)/shops/[id]/edit', { id: String(shop.id) })}>
                        <i class="fa-solid fa-pen-to-square"></i>
                        {m.edit_shop()}
                      </a>
                    </li>
                    <li>
                      <button
                        onclick={() => {
                          if (pendingDeleteRequest) return;
                          showDeleteRequestModal = true;
                        }}
                        disabled={!!pendingDeleteRequest}
                        class:opacity-50={!!pendingDeleteRequest}
                        class:cursor-not-allowed={!!pendingDeleteRequest}
                        title={pendingDeleteRequest
                          ? m.shop_delete_request_already_pending()
                          : undefined}
                      >
                        <i class="fa-solid fa-trash-can"></i>
                        {m.request_delete_shop()}
                      </button>
                    </li>
                  </ul>
                </div>
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

      {@render header(false)}

      <!-- Sidebar -->
      <div class="order-1 not-md:mb-6 md:col-span-2 lg:col-span-1">
        <div class="sticky top-20 space-y-6">
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
                          ? formatTime(openingHours.open) + ' – ' + formatTime(openingHours.close)
                          : openingHours.openLocal + ' – ' + openingHours.closeLocal}
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
                      game.quantity * (GAMES.find((g) => g.id === game.titleId)?.seats || 1)}
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
              {#if data.user}
                <div class="border-base-content/10 mt-4 border-t pt-4">
                  {@render attend()}
                </div>
              {/if}
            </div>
          </div>

          <!-- Pending Delete Request -->
          {#if pendingDeleteRequest}
            <div class="card border-warning/40 bg-warning/5 border">
              <div class="card-body p-6">
                <h3 class="text-warning mb-3 flex items-center gap-2 text-lg font-semibold">
                  <i class="fa-solid fa-triangle-exclamation"></i>
                  {m.pending_delete_request()}
                </h3>

                <div class="space-y-2 text-sm">
                  <div>
                    <span class="text-base-content/60">{m.shop_delete_request_reason()}:</span>
                    <p class="mt-1 font-medium">{pendingDeleteRequest.reason}</p>
                  </div>
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-base-content/60">{m.request_by()}:</span>
                    <span class="text-right font-medium">
                      {pendingDeleteRequest.requestedByName ?? m.anonymous_user()}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-1">
                    <span class="text-base-content/60">{m.created_at()}:</span>
                    <span class="text-right font-medium">
                      {new Date(pendingDeleteRequest.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {#if deleteRequestProcessError}
                  <div class="alert alert-error alert-soft mt-3 py-2 text-sm">
                    {deleteRequestProcessError}
                  </div>
                {/if}

                <div class="mt-3 space-y-2">
                  <!-- Requester: retract button -->
                  {#if data.user?.id === pendingDeleteRequest.requestedBy}
                    <button
                      class="btn btn-warning btn-soft btn-sm w-full"
                      onclick={handleRetractDeleteRequest}
                      disabled={isProcessingDeleteRequest}
                    >
                      {#if isProcessingDeleteRequest}
                        <span class="loading loading-spinner loading-xs"></span>
                      {:else}
                        <i class="fa-solid fa-rotate-left"></i>
                      {/if}
                      {m.retract_delete_request()}
                    </button>
                  {/if}

                  <!-- Admin: approve/reject with review note -->
                  {#if data.user?.userType === 'site_admin'}
                    <input
                      type="text"
                      class="input input-bordered input-sm w-full"
                      placeholder={m.shop_delete_request_review_note()}
                      bind:value={deleteRequestReviewNote}
                    />
                    <div class="flex gap-2">
                      <button
                        class="btn btn-success btn-sm flex-1"
                        onclick={() => handleProcessDeleteRequest('approve')}
                        disabled={isProcessingDeleteRequest}
                      >
                        {#if isProcessingDeleteRequest}
                          <span class="loading loading-spinner loading-xs"></span>
                        {:else}
                          <i class="fa-solid fa-check"></i>
                        {/if}
                        {m.admin_approve()}
                      </button>
                      <button
                        class="btn btn-error btn-sm flex-1"
                        onclick={() => handleProcessDeleteRequest('reject')}
                        disabled={isProcessingDeleteRequest}
                      >
                        {#if isProcessingDeleteRequest}
                          <span class="loading loading-spinner loading-xs"></span>
                        {:else}
                          <i class="fa-solid fa-xmark"></i>
                        {/if}
                        {m.admin_reject()}
                      </button>
                    </div>
                  {/if}

                  <a
                    href={resolve('/(main)/shops/delete-requests/[id]', {
                      id: pendingDeleteRequest.id
                    })}
                    class="btn btn-ghost btn-sm w-full"
                  >
                    <i class="fa-solid fa-arrow-up-right-from-square"></i>
                    {m.view_delete_request()}
                  </a>
                </div>
              </div>
            </div>
          {/if}

          <!-- Attendance Reports -->
          {#if !shop.isClaimed}
            <AttendanceReports shopId={shop.id} gamesList={GAMES} />
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
                      {game.name}
                    </h3>
                    <div class="flex items-center gap-1">
                      {#if data.user && isShopOpen && isUserNearShop && !shop.isClaimed}
                        <FancyButton
                          callback={() =>
                            openReportModal({
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
                      {/if}
                      <div
                        class="btn btn-neutral btn-active btn-soft btn-sm cursor-default text-base"
                      >
                        ×{game.quantity}
                      </div>
                    </div>
                  </div>

                  <div class="space-y-2 text-sm">
                    <div class="group-hover:text-accent flex items-center gap-2 transition-colors">
                      <i class="fa-solid fa-gamepad"></i>
                      {#if game.version}
                        <span>{getGameName(gameInfo?.key) || game.name} · {game.version}</span>
                      {:else}
                        <span>{getGameName(gameInfo?.key) || game.name}</span>
                      {/if}
                    </div>
                    {#if costs[game.gameId]}
                      <div
                        class="group-hover:text-warning flex items-center gap-2 transition-colors"
                      >
                        <i class="fa-solid fa-coins"></i>
                        {@html costs[game.gameId]}
                      </div>
                    {/if}
                    {#if gameComments[game.gameId]}
                      <div class="flex items-start gap-2 whitespace-pre-line">
                        <i class="fa-solid fa-circle-info mt-1"></i>
                        <div
                          class="prose prose-sm flex h-auto flex-1 items-center gap-2 overflow-auto"
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

        <!-- Photos Section -->
        {#if shop}
          <section class="mt-8">
            <PhotoCarousel
              shopId={shop.id}
              bind:photos
              currentUserId={data.user?.id}
              isAdmin={data.user?.userType === 'site_admin'}
            />
          </section>
        {/if}

        <!-- Comments Section -->
        <section class="mt-8">
          <h2 class="mb-6 flex items-center gap-2 text-xl font-semibold">
            <i class="fa-solid fa-comments"></i>
            {m.comments()} ({comments.length})
          </h2>

          <!-- Add comment form -->
          {#if data.user}
            <div class="bg-base-100 mb-6 rounded-xl p-4">
              {#if commentError}
                <div class="alert alert-error mb-4">
                  <i class="fa-solid fa-exclamation-triangle"></i>
                  <span>{commentError}</span>
                </div>
              {/if}

              <MarkdownEditor
                bind:value={newCommentContent}
                placeholder={m.comment_placeholder()}
                disabled={isSubmittingComment}
                minHeight="min-h-[100px]"
              />

              <div class="mt-3 flex justify-end">
                <button
                  class="btn btn-primary btn-sm"
                  onclick={handleCommentSubmit}
                  disabled={isSubmittingComment || !newCommentContent.trim()}
                >
                  {#if isSubmittingComment}
                    <span class="loading loading-spinner loading-sm"></span>
                  {:else}
                    <i class="fa-solid fa-paper-plane"></i>
                  {/if}
                  {m.post_comment()}
                </button>
              </div>
            </div>
          {:else}
            <div class="bg-base-200 mb-6 flex flex-col items-center gap-2 rounded-xl p-4">
              <i class="fa-solid fa-comment text-base-content/40 text-2xl"></i>
              <button
                class="text-base-content/60 hover:link-accent cursor-pointer text-sm transition-colors"
                onclick={() => {
                  window.dispatchEvent(new CustomEvent('nearcade-login'));
                }}
              >
                {m.login_to_comment()}
              </button>
            </div>
          {/if}

          <!-- Comments list -->
          {#if comments.length > 0}
            <div class="space-y-1">
              {#each comments.filter((c) => !c.parentCommentId) as comment (comment.id)}
                <div>
                  <Comment
                    {comment}
                    currentUserId={data.user?.id}
                    canReply={!!data.user}
                    canEdit={false}
                    onVote={data.user ? handleCommentVote : undefined}
                    onReply={data.user ? handleCommentReply : undefined}
                    onEdit={handleCommentEdit}
                    onDelete={handleCommentDelete}
                    isPostRendered={isCommentsRendered}
                    depth={0}
                  />

                  <!-- Reply form -->
                  {#if replyingTo === comment.id}
                    <div class="bg-base-200 mt-2 ml-8 rounded-xl p-4">
                      {#if commentError}
                        <div class="alert alert-error mb-4">
                          <i class="fa-solid fa-exclamation-triangle"></i>
                          <span>{commentError}</span>
                        </div>
                      {/if}

                      <MarkdownEditor
                        bind:value={replyContent}
                        placeholder={m.reply_to_comment()}
                        disabled={isSubmittingReply}
                        minHeight="min-h-[100px]"
                      />

                      <div class="mt-3 flex items-center justify-end">
                        <div class="flex gap-2">
                          <button
                            class="btn btn-ghost btn-sm"
                            onclick={() => {
                              replyingTo = null;
                              replyContent = '';
                            }}
                            disabled={isSubmittingReply}
                          >
                            {m.cancel()}
                          </button>
                          <button
                            class="btn btn-primary btn-sm"
                            onclick={submitReply}
                            disabled={isSubmittingReply || !replyContent.trim()}
                          >
                            {#if isSubmittingReply}
                              <span class="loading loading-spinner loading-sm"></span>
                            {:else}
                              <i class="fa-solid fa-paper-plane"></i>
                            {/if}
                            {m.reply()}
                          </button>
                        </div>
                      </div>
                    </div>
                  {/if}

                  <!-- Nested replies -->
                  {#each comments.filter((c) => c.parentCommentId === comment.id) as reply (reply.id)}
                    <Comment
                      comment={reply}
                      currentUserId={data.user?.id}
                      canReply={!!data.user}
                      canEdit={false}
                      onVote={data.user ? handleCommentVote : undefined}
                      onReply={data.user ? handleCommentReply : undefined}
                      onEdit={handleCommentEdit}
                      onDelete={handleCommentDelete}
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
      </div>
    </div>
  </div>

  <!-- Attendance Modal -->
  <AttendanceModal
    bind:isOpen={showAttendanceModal}
    {shop}
    {now}
    onClose={() => (showAttendanceModal = false)}
    onAttend={handleAttend}
  />

  <!-- Report Attendance Modal -->
  {#if showReportAttendanceModal && selectedGameForReport}
    <div class="modal modal-open">
      <div class="modal-box">
        <h3 class="mb-4 text-lg font-bold">
          {m.report_current_attendance()}
        </h3>

        <div class="mb-4">
          <p class="text-base-content/70 mb-2 flex items-center gap-2 text-sm">
            <i class="fa-solid fa-gamepad"></i>
            <span
              ><strong>{selectedGameForReport.name}</strong> · {selectedGameForReport.version}</span
            >
          </p>
          <p class="text-base-content/70 mb-4 text-sm">
            {m.report_attendance_description()}
          </p>

          <label class="form-control w-full">
            <div class="label">
              <span class="label-text">{m.current_players()}</span>
            </div>
            <input
              type="number"
              min="0"
              max="50"
              bind:value={reportedAttendance}
              class="input input-bordered w-full"
              placeholder="1"
            />
          </label>
        </div>

        <div class="modal-action">
          <button
            class="btn btn-ghost"
            onclick={() => {
              showReportAttendanceModal = false;
              selectedGameForReport = null;
            }}
            disabled={isLoading === 2}
          >
            {m.cancel()}
          </button>
          <button
            class="btn btn-primary"
            onclick={handleReportAttendance}
            disabled={isLoading === 2 || reportedAttendance < 0}
          >
            {#if isLoading === 2}
              <span class="loading loading-spinner loading-xs"></span>
            {/if}
            {m.submit()}
          </button>
        </div>
      </div>
      <div
        class="modal-backdrop"
        role="button"
        tabindex="0"
        onclick={() => {
          showReportAttendanceModal = false;
          selectedGameForReport = null;
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            showReportAttendanceModal = false;
            selectedGameForReport = null;
          }
        }}
      ></div>
    </div>
  {/if}

  <!-- Delete Request Modal -->
  {#if showDeleteRequestModal && shop}
    <div class="modal modal-open">
      <div class="modal-box">
        <h3 class="mb-4 text-lg font-bold">
          <i class="fa-solid fa-trash-can text-warning mr-2"></i>
          {m.request_delete_shop()}
        </h3>

        {#if deleteRequestError}
          <div class="alert alert-error alert-soft mb-4">
            <i class="fa-solid fa-exclamation-triangle"></i>
            <span>{deleteRequestError}</span>
          </div>
        {/if}

        <div class="form-control mb-4">
          <label class="label" for="delete-request-reason">
            <span class="label-text">{m.shop_delete_request_reason()}</span>
          </label>
          <textarea
            id="delete-request-reason"
            class="textarea textarea-bordered w-full rounded-xl"
            rows="4"
            placeholder={m.shop_delete_request_reason_placeholder()}
            bind:value={deleteRequestReason}
            disabled={isSubmittingDeleteRequest}
          ></textarea>
        </div>

        <div class="modal-action">
          <button
            class="btn btn-ghost"
            onclick={() => {
              showDeleteRequestModal = false;
              deleteRequestReason = '';
              deleteRequestError = '';
            }}
            disabled={isSubmittingDeleteRequest}
          >
            {m.cancel()}
          </button>
          <button
            class="btn btn-warning"
            onclick={handleSubmitDeleteRequest}
            disabled={isSubmittingDeleteRequest || !deleteRequestReason.trim()}
          >
            {#if isSubmittingDeleteRequest}
              <span class="loading loading-spinner loading-xs"></span>
            {:else}
              <i class="fa-solid fa-paper-plane"></i>
            {/if}
            {m.submit_delete_request()}
          </button>
        </div>
      </div>
      <div
        class="modal-backdrop"
        role="button"
        tabindex="0"
        onclick={() => {
          showDeleteRequestModal = false;
          deleteRequestReason = '';
          deleteRequestError = '';
        }}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            showDeleteRequestModal = false;
            deleteRequestReason = '';
            deleteRequestError = '';
          }
        }}
      ></div>
    </div>
  {/if}

  <!-- Delete Request Success Toast -->
  {#if deleteRequestSuccess}
    <div class="toast toast-end toast-bottom z-50">
      <div class="alert alert-success">
        <i class="fa-solid fa-circle-check"></i>
        <span>{deleteRequestSuccess}</span>
        <button
          class="btn btn-ghost btn-xs"
          onclick={() => (deleteRequestSuccess = '')}
          aria-label={m.close()}
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  {/if}
{/if}
