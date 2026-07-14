type CookieMap = Record<string, string | undefined>;

export function parseCookieHeader(cookieHeader: string): CookieMap {
  const result: CookieMap = {};
  for (const pair of cookieHeader.split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const [name, ...rest] = trimmed.split('=');
    const value = rest.length > 0 ? rest.join('=').trim() : '';
    result[name?.trim() ?? ''] = decodeURIComponent(value);
  }
  return result;
}

export function stringifyCookieHeader(cookies: CookieMap): string {
  return Object.entries(cookies)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
}

export function setRequestCookie(request: Request, name: string, value: string): Request {
  const headers = new Headers(request.headers);
  const existing = headers.get('cookie') ?? '';
  const cookies = parseCookieHeader(existing);
  cookies[name] = value;
  headers.set('cookie', stringifyCookieHeader(cookies));
  return new Request(request, { headers });
}

export function getRequestCookieValue(request: Request, name: string): string | undefined {
  return parseCookieHeader(request.headers.get('cookie') ?? '')[name];
}
