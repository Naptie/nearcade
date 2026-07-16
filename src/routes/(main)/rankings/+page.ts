import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
  const target = url.pathname.replace(/\/rankings\/?$/, '/rankings/campus');
  redirect(302, target + url.search);
};
