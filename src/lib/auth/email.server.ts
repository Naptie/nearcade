import nodemailer from 'nodemailer';
import { env } from '$env/dynamic/private';
import { m } from '$lib/paraglide/messages';
import { extractLocaleFromRequest } from '$lib/paraglide/runtime';

type SupportedLocale = 'en' | 'zh' | 'ja';

type VerificationEmailUser = {
  email: string;
  name?: string | null;
  displayName?: string | null;
  image?: string | null;
};

type VerificationEmailParams = {
  user: VerificationEmailUser;
  url: string;
  request?: Request;
};

type StudentVerificationEmailParams = {
  user: VerificationEmailUser;
  universityName: string;
  email: string;
  url: string;
  request?: Request;
};

const EMAIL_THEME = {
  pageBackground: '#e8e8e8',
  cardBackground: '#ffffff',
  cardBorder: '#d1d1d1',
  text: '#333c4d',
  muted: '#5f6b7a',
  primary: '#66cc8a',
  primaryContent: '#223d30',
  accent: '#f68067',
  infoBackground: '#f7faf8'
} as const;

let transporter: nodemailer.Transporter | null = null;

function getLocale(request?: Request): SupportedLocale {
  if (!request) {
    return 'en';
  }

  const locale = extractLocaleFromRequest(request);
  return locale === 'zh' || locale === 'ja' ? locale : 'en';
}

function getTransporter() {
  if (transporter) {
    return transporter;
  }

  const host = env.SMTP_HOST?.trim();
  const port = Number(env.SMTP_PORT ?? '');
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();

  if (!host || !Number.isFinite(port) || !user || !password) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASSWORD are required');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: {
      user,
      pass: password
    }
  });

  return transporter;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getUserPresentation(user: VerificationEmailUser) {
  const username = user.name?.trim() || null;
  const handle = username ? `@${username}` : null;
  const displayName = user.displayName?.trim() || handle || user.email;
  const initialSource = user.displayName?.trim() || username || user.email;

  return {
    displayName,
    handle,
    initials: initialSource.charAt(0).toUpperCase(),
    image: user.image?.trim() || null
  };
}

function splitAppName(appName: string) {
  const midIndex = Math.ceil(appName.length / 2);
  return {
    firstPart: appName.slice(0, midIndex),
    secondPart: appName.slice(midIndex)
  };
}

function renderWordmark(appName: string) {
  const { firstPart, secondPart } = splitAppName(appName);

  return `<div style="margin:0 0 16px;font-family:'Sora Variable','Sora','Noto Sans SC Variable','Noto Sans CJK SC',sans-serif;font-size:32px;font-weight:800;letter-spacing:-0.04em;line-height:1;color:${EMAIL_THEME.text};text-shadow:rgba(0,0,0,0.1) 0 1px 2px, rgba(0,0,0,0.1) 0 3px 2px, rgba(0,0,0,0.1) 0 4px 8px;"><span style="display:inline-block;padding-right:0.03em;color:#0ea5e9;background-image:linear-gradient(to right bottom, #0ea5e9 0%, #a855f7 50%, #f43f5e 100%);background-clip:text;-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${escapeHtml(firstPart)}</span><span>${escapeHtml(secondPart)}</span></div>`;
}

export async function sendVerificationLinkEmail({ user, url, request }: VerificationEmailParams) {
  const locale = getLocale(request);
  const appName = m.app_name({}, { locale });
  const subject = m.email_verification_subject({}, { locale });
  const intro = m.email_verification_intro({}, { locale });
  const button = m.email_verification_button({}, { locale });
  const fallback = m.email_verification_fallback({}, { locale });
  const ignore = m.email_verification_ignore({}, { locale });
  const accountInformation = m.account_information({}, { locale });
  const usernameLabel = m.username({}, { locale });
  const { displayName, handle, initials, image } = getUserPresentation(user);
  const wordmark = renderWordmark(appName);

  const escapedUrl = escapeHtml(url);
  const text = [
    intro,
    '',
    `${accountInformation}: ${displayName}`,
    ...(handle && handle !== displayName ? [`${usernameLabel}: ${handle}`] : []),
    '',
    url,
    '',
    ignore
  ].join('\n');
  const avatar = image
    ? `<img src="${escapeHtml(image)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:999px;object-fit:cover;border:1px solid ${EMAIL_THEME.cardBorder};" />`
    : `<div style="width:64px;height:64px;border-radius:999px;background:${EMAIL_THEME.primary};color:${EMAIL_THEME.primaryContent};font-size:26px;font-weight:700;line-height:64px;text-align:center;border:1px solid ${EMAIL_THEME.cardBorder};">${escapeHtml(initials)}</div>`;
  const html = `
    <div style="background:${EMAIL_THEME.pageBackground};padding:32px 16px;font-family:'Sora Variable','Sora','Noto Sans SC Variable','Noto Sans CJK SC',sans-serif;color:${EMAIL_THEME.text};">
      <div style="max-width:560px;margin:0 auto;">
        <div style="height:6px;background:${EMAIL_THEME.primary};border-radius:24px 24px 0 0;"></div>
        <div style="background:${EMAIL_THEME.cardBackground};border:1px solid ${EMAIL_THEME.cardBorder};border-top:none;border-radius:0 0 24px 24px;padding:32px;box-shadow:0 18px 40px rgba(51,60,77,0.08);">
          ${wordmark}
          <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:${EMAIL_THEME.text};">${escapeHtml(subject)}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:${EMAIL_THEME.muted};">${escapeHtml(intro)}</p>
          <div style="margin:0 0 24px;padding:18px;border:1px solid ${EMAIL_THEME.cardBorder};border-radius:18px;background:${EMAIL_THEME.infoBackground};">
            <div style="margin:0 0 14px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_THEME.muted};">${escapeHtml(accountInformation)}</div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td style="vertical-align:middle;">${avatar}</td>
                <td style="padding-left:14px;vertical-align:middle;">
                  <div style="margin:0;font-size:18px;font-weight:700;line-height:1.3;color:${EMAIL_THEME.text};">${escapeHtml(displayName)}</div>
                  ${handle && handle !== displayName ? `<div style="margin:4px 0 0;font-size:13px;line-height:1.5;color:${EMAIL_THEME.muted};">${escapeHtml(usernameLabel)}: ${escapeHtml(handle)}</div>` : ''}
                </td>
              </tr>
            </table>
          </div>
          <p style="margin:0 0 24px;">
            <a href="${escapedUrl}" style="display:inline-block;background:${EMAIL_THEME.primary};color:${EMAIL_THEME.primaryContent};text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:700;">${escapeHtml(button)}</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${EMAIL_THEME.muted};">${escapeHtml(fallback)}</p>
          <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;">
            <a href="${escapedUrl}" style="color:${EMAIL_THEME.accent};text-decoration:none;">${escapedUrl}</a>
          </p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:${EMAIL_THEME.muted};">${escapeHtml(ignore)}</p>
        </div>
      </div>
    </div>`;

  await getTransporter().sendMail({
    from: env.SMTP_FROM?.trim() || env.SMTP_USER,
    to: user.email,
    subject,
    text,
    html
  });
}

export async function sendStudentVerificationLinkEmail({
  user,
  universityName,
  email,
  url,
  request
}: StudentVerificationEmailParams) {
  const locale = getLocale(request);
  const appName = m.app_name({}, { locale });
  const subject = m.student_email_verification_subject({}, { locale });
  const intro = m.student_email_verification_intro({ university: universityName }, { locale });
  const button = m.student_email_verification_button({}, { locale });
  const fallback = m.student_email_verification_fallback({}, { locale });
  const ignore = m.student_email_verification_ignore({}, { locale });
  const detailsTitle = m.account_information({}, { locale });
  const universityLabel = m.university({}, { locale });
  const emailLabel = m.email_address({}, { locale });
  const usernameLabel = m.username({}, { locale });
  const { displayName, handle, initials, image } = getUserPresentation(user);
  const wordmark = renderWordmark(appName);

  const escapedUrl = escapeHtml(url);
  const escapedUniversityName = escapeHtml(universityName);
  const escapedEmail = escapeHtml(email);
  const text = [
    intro,
    '',
    `${detailsTitle}: ${displayName}`,
    ...(handle && handle !== displayName ? [`${usernameLabel}: ${handle}`] : []),
    `${universityLabel}: ${universityName}`,
    `${emailLabel}: ${email}`,
    '',
    url,
    '',
    ignore
  ].join('\n');
  const avatar = image
    ? `<img src="${escapeHtml(image)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:999px;object-fit:cover;border:1px solid ${EMAIL_THEME.cardBorder};" />`
    : `<div style="width:64px;height:64px;border-radius:999px;background:${EMAIL_THEME.primary};color:${EMAIL_THEME.primaryContent};font-size:26px;font-weight:700;line-height:64px;text-align:center;border:1px solid ${EMAIL_THEME.cardBorder};">${escapeHtml(initials)}</div>`;
  const html = `
    <div style="background:${EMAIL_THEME.pageBackground};padding:32px 16px;font-family:'Sora Variable','Sora','Noto Sans SC Variable','Noto Sans CJK SC',sans-serif;color:${EMAIL_THEME.text};">
      <div style="max-width:560px;margin:0 auto;">
        <div style="height:6px;background:${EMAIL_THEME.primary};border-radius:24px 24px 0 0;"></div>
        <div style="background:${EMAIL_THEME.cardBackground};border:1px solid ${EMAIL_THEME.cardBorder};border-top:none;border-radius:0 0 24px 24px;padding:32px;box-shadow:0 18px 40px rgba(51,60,77,0.08);">
          ${wordmark}
          <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:${EMAIL_THEME.text};">${escapeHtml(subject)}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:${EMAIL_THEME.muted};">${escapeHtml(intro)}</p>
          <div style="margin:0 0 24px;padding:18px;border:1px solid ${EMAIL_THEME.cardBorder};border-radius:18px;background:${EMAIL_THEME.infoBackground};">
            <div style="margin:0 0 14px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_THEME.muted};">${escapeHtml(detailsTitle)}</div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;width:100%;">
              <tr>
                <td style="vertical-align:middle;width:64px;">${avatar}</td>
                <td style="padding-left:14px;vertical-align:middle;">
                  <div style="margin:0;font-size:18px;font-weight:700;line-height:1.3;color:${EMAIL_THEME.text};">${escapeHtml(displayName)}</div>
                  ${handle && handle !== displayName ? `<div style="margin:4px 0 0;font-size:13px;line-height:1.5;color:${EMAIL_THEME.muted};">${escapeHtml(usernameLabel)}: ${escapeHtml(handle)}</div>` : ''}
                </td>
              </tr>
            </table>
            <div style="margin-top:16px;border-top:1px solid ${EMAIL_THEME.cardBorder};padding-top:16px;display:grid;gap:12px;">
              <div>
                <div style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_THEME.muted};">${escapeHtml(universityLabel)}</div>
                <div style="margin:0;font-size:15px;line-height:1.6;color:${EMAIL_THEME.text};">${escapedUniversityName}</div>
              </div>
              <div>
                <div style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_THEME.muted};">${escapeHtml(emailLabel)}</div>
                <div style="margin:0;font-size:15px;line-height:1.6;word-break:break-all;color:${EMAIL_THEME.text};">${escapedEmail}</div>
              </div>
            </div>
          </div>
          <p style="margin:0 0 24px;">
            <a href="${escapedUrl}" style="display:inline-block;background:${EMAIL_THEME.primary};color:${EMAIL_THEME.primaryContent};text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:700;">${escapeHtml(button)}</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${EMAIL_THEME.muted};">${escapeHtml(fallback)}</p>
          <p style="margin:0 0 24px;font-size:13px;line-height:1.6;word-break:break-all;">
            <a href="${escapedUrl}" style="color:${EMAIL_THEME.accent};text-decoration:none;">${escapedUrl}</a>
          </p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:${EMAIL_THEME.muted};">${escapeHtml(ignore)}</p>
        </div>
      </div>
    </div>`;

  await getTransporter().sendMail({
    from: env.SMTP_FROM?.trim() || env.SMTP_USER,
    to: email,
    subject,
    text,
    html
  });
}
