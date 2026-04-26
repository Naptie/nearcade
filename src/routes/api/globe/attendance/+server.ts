import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAllShopsAttendanceData } from '$lib/endpoints/attendance.server';

export const GET: RequestHandler = async () => {
  const attendanceMap = await getAllShopsAttendanceData();
  return json(Object.fromEntries(attendanceMap));
};
