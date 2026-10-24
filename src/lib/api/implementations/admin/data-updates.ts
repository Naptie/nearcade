/**
 * The data-update task monitor: the state of every task, and the trigger that
 * starts one.
 *
 * Both procedures answer with the task list plus the absolute trigger URL, so
 * an unattended caller can replay the trigger without knowing the deployment's
 * origin.
 */

import { implement } from '@orpc/server';
import type { z } from 'zod';
import {
  DATA_UPDATE_TASK_IDS,
  getAdminDataUpdateTriggerUrl,
  getDataUpdateTask,
  listDataUpdateTasks,
  triggerDataUpdate,
  type DataUpdateTaskId
} from '$lib/admin/data-updates.server';
import { m } from '$lib/paraglide/messages';
import { toPlainArray, toPlainObject } from '$lib/utils';
import { adminContract, dataUpdateTaskSchema } from '../../contracts/admin';
import type { ApiContext } from '../../context';
import { apiError } from '../../errors';
import { siteAdminOrSecret } from './shared';

const impl = implement(adminContract).$context<ApiContext>();

/**
 * Parse a data-update task id.
 *
 * The legacy handler answered 400 for an unknown task id, and so does this
 * one — the contract only carries the raw string.
 */
const parseTaskId = (value: string | null | undefined): DataUpdateTaskId => {
  if (!value || !DATA_UPDATE_TASK_IDS.includes(value as DataUpdateTaskId)) {
    apiError('BAD_REQUEST', m.missing_required_fields());
  }

  return value as DataUpdateTaskId;
};

export const adminDataUpdatesImplementation = {
  /** `GET /api/admin/data-updates` */
  dataUpdates: impl.dataUpdates.use(siteAdminOrSecret).handler(async ({ input, context }) => {
    const triggerUrl = getAdminDataUpdateTriggerUrl(context.event.request);

    if (input.task) {
      return {
        task: toPlainObject(await getDataUpdateTask(parseTaskId(input.task))) as unknown as z.input<
          typeof dataUpdateTaskSchema
        >,
        triggerUrl
      };
    }

    return {
      tasks: toPlainArray(await listDataUpdateTasks()) as unknown as Array<
        z.input<typeof dataUpdateTaskSchema>
      >,
      triggerUrl
    };
  }),

  /** `POST /api/admin/data-updates` */
  triggerDataUpdate: impl.triggerDataUpdate
    .use(siteAdminOrSecret)
    .handler(async ({ input, context }) => {
      // The middleware resolved which of the two callers authorized the call.
      const trigger = context.admin;

      const taskId = parseTaskId(input.task);
      const result = await triggerDataUpdate(taskId, trigger);

      return {
        started: result.started,
        alreadyRunning: result.alreadyRunning,
        task: toPlainObject(result.task) as unknown as z.input<typeof dataUpdateTaskSchema>,
        triggerUrl: getAdminDataUpdateTriggerUrl(context.event.request)
      };
    })
};
