// Daily website check (.github/workflows/check-site.yml). Asks the live site's /api/status
// for its health checks (scripts/health-checks.mjs) and, when something has failed:
//   - emails ALERT_TO (Cate and Dom) once, when the problem first appears or changes,
//     with a reminder every 7 days while it lasts, and once more when it's all fixed;
//   - keeps a GitHub issue open (label "site-health") as the record and as a backup alert:
//     it mentions @domdonald52, so GitHub emails Dom even if the email below can't be sent.
// Warnings appear on the status page and in these emails, but never trigger an email alone.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const SITE = process.env.SITE_URL || 'https://catepates.co.nz';
const STATUS_PAGE = new URL('/status.html', SITE).href;
const { GITHUB_TOKEN, GITHUB_REPOSITORY, RUN_URL, TEST, ALERT_TO, ALERT_EMAIL_USER, ALERT_EMAIL_PASSWORD } = process.env;
const LABEL = 'site-health';
const REMIND_DAYS = 7;

// 1. Run the checks (on the live site, so they see exactly what visitors get).
let checks;
try {
  const res = await fetch(new URL('/api/status', SITE), { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  ({ checks } = await res.json());
  if (!Array.isArray(checks)) throw new Error('no checks in the answer');
} catch (err) {
  checks = [{ area: 'Website', name: 'Status check', level: 'fail', detail: `${SITE}/api/status couldn't be reached (${err.message}), so the site or its Netlify functions may be down`, fix: 'Dom: open the site, then check the latest deploy and Visitor access in Netlify.' }];
}
if (TEST === 'true') checks.push({ area: 'Test', name: 'Pretend problem', level: 'fail', detail: 'this is a test run of the alert email', fix: 'Nothing to do: run the check again without "Pretend it failed" to see the "all fixed" email.' });

const fails = checks.filter((c) => c.level === 'fail');
const warns = checks.filter((c) => c.level === 'warn');
for (const c of checks) console.log(`${c.level.padEnd(4)} ${c.area}: ${c.name}: ${c.detail}`);

const item = (c) => `- ${c.area}: ${c.name}\n  ${c.detail}\n  What to do: ${c.fix || '—'}`;
const report = () => [
  fails.length ? `Needs fixing:\n\n${fails.map(item).join('\n\n')}` : '',
  warns.length ? `Worth a look (not urgent):\n\n${warns.map(item).join('\n\n')}` : '',
].filter(Boolean).join('\n\n');
const fingerprint = fails.map((c) => `${c.area}|${c.name}`).sort().join('\n');

if (!GITHUB_TOKEN) {
  console.log(`\n(No GITHUB_TOKEN: local run, nothing sent.)\n\n${report() || 'All good.'}`);
  process.exit(0);
}

// 2. GitHub issue = memory of what has already been emailed.
const gh = async (path, method = 'GET', body) => {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    method,
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};
const [open] = await gh(`/issues?labels=${LABEL}&state=open&per_page=1`);
const lastPrint = open?.body?.match(/<!-- fingerprint\n([\s\S]*?)\n-->/)?.[1] ?? null;
const issueBody = () => `@domdonald52 The daily website check found ${fails.length} problem(s). Cate has been emailed too.\n\nLive status: ${STATUS_PAGE}\n\n${report()}\n\nThis issue closes itself when the check passes again. Run: ${RUN_URL}\n\n<!-- fingerprint\n${fingerprint}\n-->`;

// 3. Email (Gmail SMTP with an app password, sent with curl).
function email(subject, text) {
  if (!ALERT_TO || !ALERT_EMAIL_USER || !ALERT_EMAIL_PASSWORD) {
    console.log('Email not sent: ALERT_EMAIL_USER / ALERT_EMAIL_PASSWORD secrets are not set. The GitHub issue still notifies Dom.');
    return;
  }
  const to = ALERT_TO.split(',').map((s) => s.trim()).filter(Boolean);
  writeFileSync('mail.txt', [
    `From: catepates.co.nz website check <${ALERT_EMAIL_USER}>`,
    `To: ${to.join(', ')}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    `${text}\n\nSee the live status: ${STATUS_PAGE}\n\n(Sent automatically by the daily website check.)`,
  ].join('\r\n'));
  const args = ['--silent', '--show-error', '--ssl-reqd', '--url', 'smtps://smtp.gmail.com:465', '--user', `${ALERT_EMAIL_USER}:${ALERT_EMAIL_PASSWORD}`, '--mail-from', ALERT_EMAIL_USER, ...to.flatMap((t) => ['--mail-rcpt', t]), '--upload-file', 'mail.txt'];
  const r = spawnSync('curl', args, { encoding: 'utf8' });
  if (r.status !== 0) { console.log(`Email failed: ${r.stderr}`); process.exitCode = 1; } else console.log(`Emailed ${to.join(', ')}: ${subject}`);
}

const n = fails.length;
const subjectBad = `catepates.co.nz: ${n} thing${n === 1 ? ' needs' : 's need'} fixing`;
if (n && !open) {
  await gh('/issues', 'POST', { title: subjectBad, labels: [LABEL], body: issueBody() });
  email(subjectBad, `The daily check of catepates.co.nz found a problem.\n\n${report()}`);
} else if (n && fingerprint !== lastPrint) {
  await gh(`/issues/${open.number}`, 'PATCH', { title: subjectBad, body: issueBody() });
  await gh(`/issues/${open.number}/comments`, 'POST', { body: `The problems changed.\n\n${report()}` });
  email(subjectBad, `The problems on catepates.co.nz have changed since the last email.\n\n${report()}`);
} else if (n) {
  const days = (Date.now() - new Date(open.updated_at)) / 86400000;
  if (days >= REMIND_DAYS) {
    await gh(`/issues/${open.number}/comments`, 'POST', { body: `Still not fixed after ${Math.round(days)} days.` });
    email(`Reminder: ${subjectBad}`, `These are still not fixed on catepates.co.nz.\n\n${report()}`);
  } else {
    console.log(`Already reported in issue #${open.number}; no new email.`);
  }
} else if (open) {
  await gh(`/issues/${open.number}/comments`, 'POST', { body: 'All checks pass again.' });
  await gh(`/issues/${open.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
  email('catepates.co.nz: all fixed', `Everything the website needs is working again.${warns.length ? `\n\n${report()}` : ''}`);
} else {
  console.log('All good.');
}
