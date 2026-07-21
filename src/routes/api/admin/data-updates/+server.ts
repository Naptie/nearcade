import { error, json, type RequestHandler } from '@sveltejs/kit';
import { SSC_SECRET } from '$env/static/private';
import {
  DATA_UPDATE_TASK_IDS,
  getAdminDataUpdateTriggerUrl,
  getDataUpdateTask,
  listDataUpdateTasks,
  triggerDataUpdate,
  type DataUpdateTaskId,
  type DataUpdateTriggerContext
} from '$lib/admin/data-updates.server';
import { m } from '$lib/paraglide/messages';
import { toPlainArray, toPlainObject } from '$lib/utils';

const hasValidSecret = (request: Request) => {
  const authHeader = request.headers.get('Authorization');
  const normalized = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  return normalized === SSC_SECRET;
};

const requireSiteAdminOrSecret = (request: Request, locals: App.Locals) => {
  if (hasValidSecret(request)) {
    return {
      source: 'ssc',
      userId: null,
      userName: 'Remote service'
    } satisfies DataUpdateTriggerContext;
  }

  const session = locals.session;
  if (!session?.user) {
    error(401, m.unauthorized());
  }

  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  return {
    source: 'site_admin',
    userId: session.user.id,
    userName: session.user.displayName || session.user.name || session.user.id
  } satisfies DataUpdateTriggerContext;
};

const parseTaskId = (value: string | null): DataUpdateTaskId => {
  if (!value || !DATA_UPDATE_TASK_IDS.includes(value as DataUpdateTaskId)) {
    error(400, m.missing_required_fields());
  }

  return value as DataUpdateTaskId;
};

export const GET: RequestHandler = async ({ locals, request, url }) => {
  requireSiteAdminOrSecret(request, locals);

  const taskId = url.searchParams.get('task');
  const triggerUrl = getAdminDataUpdateTriggerUrl(request);

  if (taskId) {
    return json({
      task: toPlainObject(await getDataUpdateTask(parseTaskId(taskId))),
      triggerUrl
    });
  }

  return json({
    tasks: toPlainArray(await listDataUpdateTasks()),
    triggerUrl
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const trigger = requireSiteAdminOrSecret(request, locals);

  let body: { task?: string } | null = null;
  try {
    body = await request.json();
  } catch {
    error(400, m.missing_required_fields());
  }

  const taskId = parseTaskId(body?.task ?? null);
  const result = await triggerDataUpdate(taskId, trigger);

  return json({
    started: result.started,
    alreadyRunning: result.alreadyRunning,
    task: toPlainObject(result.task),
    triggerUrl: getAdminDataUpdateTriggerUrl(request)
  });
};
