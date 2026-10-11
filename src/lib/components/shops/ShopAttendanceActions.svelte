<script module lang="ts">
  import type { User } from '$lib/auth/types';

  /** A merged reported-attendance entry, used to prefill the report modal. */
  export interface ReportedAttendanceSummary {
    id: number;
    count: number | undefined;
    reportedBy: User | undefined;
    reportedAt: string;
    comment: string | null;
  }
</script>

<script lang="ts">
  import { m } from '$lib/paraglide/messages';
  import type { Shop, AttendanceData } from '$lib/types';
  import AttendanceModal from '$lib/components/AttendanceModal.svelte';
  import { formatDistance, formatTime } from '$lib/utils';
  import { fromPath } from '$lib/utils/scoped';

  interface Props {
    shop: Shop;
    user: User | undefined;
    /** Ticking clock shared with the page; drives open state and the modal. */
    now: Date;
    /** Live attendance entries for this shop. */
    attendanceData: AttendanceData;
    /** Most recent reported attendance per game, for report-modal prefill. */
    reportedAttendances: ReportedAttendanceSummary[];
    /** Set when the viewer is currently attending another shop. */
    otherAttendance?: { shop: Shop; attendedAt: Date | string } | null;
    isShopOpen: boolean;
    /** `null` while the proximity check is still running. */
    isUserNearShop: boolean | null;
    distance: number | null;
    locationError: string | null;
    canProtectedShopAction: boolean;
    protectedShopActionMessage?: string;
    /** Refreshes the parent's attendance data after a successful mutation. */
    onChanged: () => void | Promise<void>;
    class?: string;
  }

  let {
    shop,
    user,
    now,
    attendanceData,
    reportedAttendances,
    otherAttendance = null,
    isShopOpen,
    isUserNearShop,
    distance,
    locationError,
    canProtectedShopAction,
    protectedShopActionMessage,
    onChanged,
    class: klass = 'w-full'
  }: Props = $props();

  let userAttending = $derived(!!user && attendanceData.some((a) => a.userId === user.id));

  let isAttending = $state(false);

  // Attendance modal
  let showAttendanceModal = $state(false);

  // Report attendance modal
  let showReportModal = $state(false);
  let selectedGameForReport = $state<{ id: number; name: string; version: string } | null>(null);
  let reportedAttendance = $state(0);
  let isReporting = $state(false);

  const handleAttend = async (games: number[], plannedLeaveAt: Date) => {
    if (!canProtectedShopAction) return;

    isAttending = true;
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

      await onChanged();
    } catch (error) {
      console.error('Error attending:', error);
      // TODO: Show error toast
    } finally {
      isAttending = false;
    }
  };

  const handleLeave = async () => {
    if (!canProtectedShopAction) return;

    isAttending = true;
    try {
      const response = await fetch(fromPath(`/api/shops/${shop.id}/attendance`), {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to leave');
      }

      await onChanged();
    } catch (error) {
      console.error('Error leaving:', error);
      // TODO: Show error toast
    } finally {
      isAttending = false;
    }
  };

  const handleReportAttendance = async () => {
    if (!canProtectedShopAction || !selectedGameForReport) return;

    isReporting = true;
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
        await onChanged();
        showReportModal = false;
        selectedGameForReport = null;
        reportedAttendance = 0;
      }
    } catch (err) {
      console.error('Error reporting attendance:', err);
    } finally {
      isReporting = false;
    }
  };

  /** Opens the report-attendance modal for a game; called from the games list. */
  export function openReport(game: { id: number; name: string; version: string }) {
    if (!canProtectedShopAction) return;

    selectedGameForReport = game;
    reportedAttendance = reportedAttendances.find((g) => g.id === game.id)?.count || 0;
    showReportModal = true;
  }
</script>

{#if !canProtectedShopAction}
  <div class="tooltip tooltip-error {klass}" data-tip={protectedShopActionMessage}>
    <button class="btn btn-primary w-full" disabled>
      <i class="fa-solid fa-play"></i>
      {m.attend()}
    </button>
  </div>
{:else if userAttending}
  <button
    class="btn btn-error btn-soft {klass}"
    onclick={() => handleLeave()}
    disabled={isAttending}
  >
    {#if isAttending}
      <span class="loading loading-spinner loading-xs"></span>
    {:else}
      <i class="fa-solid fa-stop"></i>
    {/if}
    {m.leave()}
  </button>
{:else}
  <div
    class="tooltip-error {klass}"
    class:tooltip={!isShopOpen || shop.isClaimed || !!otherAttendance || isUserNearShop === false}
    data-tip={isShopOpen
      ? otherAttendance
        ? m.attending_other_shop({
            shopName: otherAttendance.shop.name,
            attendedAt: formatTime(otherAttendance.attendedAt)
          })
        : shop.isClaimed
          ? m.attend_claimed()
          : isUserNearShop === false && distance
            ? locationError || m.not_near_shop({ distance: formatDistance(distance, 2) })
            : ''
      : shop.isClosed
        ? m.shop_is_permanently_closed()
        : m.shop_closed()}
  >
    <button
      class="btn btn-primary w-full"
      onclick={() => (showAttendanceModal = true)}
      disabled={!isShopOpen ||
        shop.isClaimed ||
        !!otherAttendance ||
        isAttending ||
        !isUserNearShop}
    >
      <i class="fa-solid fa-play"></i>
      {m.attend()}
    </button>
  </div>
{/if}

<AttendanceModal
  bind:isOpen={showAttendanceModal}
  {shop}
  {now}
  onClose={() => (showAttendanceModal = false)}
  onAttend={handleAttend}
/>

{#if showReportModal && selectedGameForReport}
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
            showReportModal = false;
            selectedGameForReport = null;
          }}
          disabled={isReporting}
        >
          {m.cancel()}
        </button>
        <button
          class="btn btn-primary"
          onclick={handleReportAttendance}
          disabled={isReporting || reportedAttendance < 0}
        >
          {#if isReporting}
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
        showReportModal = false;
        selectedGameForReport = null;
      }}
      onkeydown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          showReportModal = false;
          selectedGameForReport = null;
        }
      }}
    ></div>
  </div>
{/if}
