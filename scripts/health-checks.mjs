// Everything the website needs in order to work, checked in one go. Used by the status page
// (netlify/functions/status.mjs → /status.html) and the daily alert email
// (.github/scripts/check-site.mjs), so both always agree.
//
// Each check comes back as { area, name, level, detail, fix }:
//   level "ok"   → fine
//   level "warn" → worth a look, but visitors aren't affected much (not emailed on its own)
//   level "fail" → something visitors would notice, or bookings/sales would be lost (emailed)
// "fix" says, in plain words, what to do about it and who usually does it.

import tls from 'node:tls';
import { gvizColumns, parseGviz } from '../netlify/functions/sheet.mjs';
import { ARTIST_PAGE, fetchText, listPieces } from './vault-parse.mjs';
import { isYes, photoUrl } from '../site/js/sheet.js';

const PAGES = ['/', '/work.html', '/workshops.html', '/media.html', '/about.html', '/terms.html'];
const ORA_FEED = 'https://oragallery.co.nz/collections/cate-pates/products.json?limit=250';
const UA = 'Mozilla/5.0 (catepates.co.nz site check)';

// Columns the site reads from each tab. Renaming or deleting one of these headings breaks
// that part of the site, so it's checked by name.
const COLUMNS = {
  Announcements: ['heading', 'details', 'label', 'button_text', 'link', 'start', 'end', 'pages', 'show'],
  Workshops: ['date', 'time', 'workshop', 'venue', 'price', 'description', 'booking_link', 'sold_out', 'show'],
  Studio: ['code', 'title', 'price', 'size', 'photo_link', 'type', 'payment_link', 'sold', 'show', 'edition'],
  Galleries: ['name', 'place', 'website', 'show', 'has_cate_s_work_now'],
  Exhibitions: ['year', 'title', 'venue', 'show', 'link'],
  Media: ['date', 'type', 'title', 'where', 'description', 'link', 'show'],
};

const SHEET_FIX = 'Cate: check the Google Sheet, or ask Dom.';
const CODE_FIX = 'Dom: ask Claude to look at it (the site keeps showing the last list it had).';

// GET a URL with a time limit; returns the HTTP status, or 0 if it couldn't be reached at all.
async function statusOf(url, timeout = 8000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
    res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}

const httpWords = (code) => (code === 0 ? "couldn't be reached" : code === 401 || code === 403 ? `is private or blocked (HTTP ${code})` : code === 404 ? 'no longer exists (HTTP 404)' : `answered HTTP ${code}`);

function certDaysLeft(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? Math.floor((new Date(cert.valid_to) - Date.now()) / 86400000) : null);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

// siteUrl: also check the site's pages, functions and certificate (left out on preview
// deploys, which need a Netlify login). stripeSecretSet: only known inside Netlify.
export async function runChecks({ siteUrl, sheetId, stripeSecretSet } = {}) {
  const checks = [];
  const add = (area, name, level, detail, fix = '') => checks.push({ area, name, level, detail, fix });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });

  // Each link once, all at the same time.
  const linkCache = new Map();
  const link = (url) => {
    if (!linkCache.has(url)) linkCache.set(url, statusOf(url));
    return linkCache.get(url);
  };
  const tasks = [];
  const linkCheck = (area, name, url, level, fix) => tasks.push(link(url).then((code) => {
    if (code >= 200 && code < 400) add(area, name, 'ok', 'link works');
    else add(area, name, level, `the link ${httpWords(code)}: ${url}`, fix);
  }));

  // --- The website itself -------------------------------------------------------------
  if (siteUrl) {
    const site = new URL(siteUrl);
    tasks.push(Promise.all(PAGES.map(async (page) => [page, await statusOf(new URL(page, site))])).then((results) => {
      const broken = results.filter(([, code]) => code !== 200);
      if (!broken.length) add('Website', 'Pages', 'ok', `all ${PAGES.length} main pages load`);
      else add('Website', 'Pages', 'fail', broken.map(([page, code]) => `${page} ${httpWords(code)}`).join('; '), 'Dom: check the latest deploy, and Site configuration → Visitor access, in Netlify.');
    }));
    for (const [api, what, fix] of [
      ['/api/sheet?tab=Galleries', 'Sheet connection', 'Dom: check SHEET_ID in Netlify → Environment variables, and the Functions log.'],
      ['/api/vault', 'The Vault live check', 'Dom: check the Functions log in Netlify (the Gallery page keeps the last list it had).'],
    ]) {
      tasks.push(statusOf(new URL(api, site)).then((code) => (code === 200
        ? add('Website', what, 'ok', 'working')
        : add('Website', what, 'fail', `${api.split('?')[0]} ${httpWords(code)}`, fix))));
    }
    if (site.protocol === 'https:' && !site.hostname.endsWith('.netlify.app')) {
      tasks.push(certDaysLeft(site.hostname).then((days) => {
        if (days === null) add('Website', 'Security certificate (https)', 'fail', "couldn't read the certificate", 'Dom: Netlify → Domain management → HTTPS.');
        else if (days < 7) add('Website', 'Security certificate (https)', 'fail', `expires in ${days} day(s)`, 'Dom: Netlify → Domain management → HTTPS → Renew certificate. Check the domain still points at Netlify.');
        else if (days < 21) add('Website', 'Security certificate (https)', 'warn', `expires in ${days} days (Netlify normally renews it automatically)`, 'Dom: if this is still showing in a week, check Netlify → Domain management → HTTPS.');
        else add('Website', 'Security certificate (https)', 'ok', `valid for ${days} more days`);
      }));
    }
  }

  // --- Google Sheet ------------------------------------------------------------------
  const tabs = {};
  if (!sheetId) {
    add('Google Sheet', 'Connected', 'fail', 'no SHEET_ID is set, so the site shows its built-in fallback lists', 'Dom: Netlify → Environment variables → SHEET_ID.');
  } else {
    await Promise.all(Object.keys(COLUMNS).map(async (tab) => {
      const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(tab)}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}: is the Sheet still shared as "Anyone with the link"?`);
        const text = await res.text();
        const missing = COLUMNS[tab].filter((c) => !gvizColumns(text).includes(c));
        tabs[tab] = parseGviz(text);
        if (missing.length) add('Google Sheet', `${tab} tab`, 'fail', `column heading(s) missing or renamed: ${missing.join(', ')}`, `${SHEET_FIX} Headings must be spelled as in Cate's guide.`);
        else add('Google Sheet', `${tab} tab`, 'ok', `${tabs[tab].length} row(s)`);
      } catch (err) {
        add('Google Sheet', `${tab} tab`, 'fail', `couldn't be read (${err.name === 'TimeoutError' ? 'Google took too long' : err.message})`, `${SHEET_FIX} The tab must keep its exact name.`);
      }
    }));
  }

  // Workshops: every shown one must have a readable date and a working booking link.
  const upcoming = [];
  for (const r of (tabs.Workshops || []).filter((w) => w.workshop && isYes(w.show))) {
    const name = `${r.workshop} (${r.date || 'no date'})`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) { add('Workshops', name, 'fail', `the date "${r.date}" can't be read, so it isn't shown`, 'Cate: type the date as DD/MM/YYYY.'); continue; }
    if (r.date < today) continue;
    upcoming.push(r);
    if (/^https?:\/\//i.test(r.booking_link || '') && !isYes(r.sold_out)) linkCheck('Workshops', `${name}: booking link`, r.booking_link, 'fail', 'Cate: check the event in Humanitix, then the Booking link in the Sheet.');
  }
  if (tabs.Workshops) {
    add('Workshops', 'Upcoming workshops', upcoming.length ? 'ok' : 'warn', upcoming.length ? `${upcoming.length} on the site` : 'none, so the site says "new dates coming soon"', upcoming.length ? '' : 'Cate: add the next dates to the Workshops tab when they are set.');
  }

  // Announcements: current ones need readable dates and a working link.
  for (const a of (tabs.Announcements || []).filter((x) => x.heading && isYes(x.show))) {
    for (const k of ['start', 'end']) {
      if (a[k] && !/^\d{4}-\d{2}-\d{2}$/.test(a[k])) add('Announcements', a.heading, 'warn', `the ${k === 'start' ? 'Start' : 'End'} date "${a[k]}" can't be read, so it's ignored`, 'Cate: type dates as DD/MM/YYYY.');
    }
    const current = !(a.end && a.end < today) && !(a.start && a.start > today);
    if (current && /^https?:\/\//i.test(a.link || '')) linkCheck('Announcements', `${a.heading}: link`, a.link, 'fail', 'Cate: fix the Link in the Announcements tab.');
  }

  // Media: recordings and articles must open for the public (a Drive file must be shared).
  for (const m of (tabs.Media || []).filter((x) => x.title && isYes(x.show) && /^https?:\/\//i.test(x.link || ''))) {
    linkCheck('Media', `${m.title}: link`, m.link, 'fail', 'Cate or Dom: a Google Drive file must be shared as "Anyone with the link"; otherwise fix the Link.');
  }

  // Studio: pieces on sale need a photo that loads and a working payment link.
  const forSale = (tabs.Studio || []).filter((x) => x.title && isYes(x.show));
  for (const s of forSale) {
    if (s.photo_link) linkCheck('Studio', `${s.title}: photo`, photoUrl(s.photo_link), 'fail', 'Cate: the photo must be in Google Drive and shared as "Anyone with the link".');
    else add('Studio', `${s.title}: photo`, 'fail', 'no Photo link, so the piece is hidden', 'Cate: add the Drive link to the photo.');
    if (/^https?:\/\//i.test(s.payment_link || '')) linkCheck('Studio', `${s.title}: payment link`, s.payment_link, 'fail', 'Cate: check the payment link is still active in Stripe.');
  }
  if (stripeSecretSet !== undefined) {
    const selling = forSale.some((s) => /^https:\/\/buy\.stripe\.com\//.test(s.payment_link || ''));
    if (selling && !stripeSecretSet) add('Studio', 'Stripe sales tracking', 'fail', 'pieces are on sale but STRIPE_WEBHOOK_SECRET is not set, so sold pieces won\'t be marked sold', 'Dom: add it in Netlify → Environment variables (Production).');
    else add('Studio', 'Stripe sales tracking', 'ok', stripeSecretSet ? 'set up' : 'not set up (only needed once pieces are for sale)');
  }

  // Galleries: other galleries' websites (a broken one is only a warning) and the two live lists.
  const galleries = (tabs.Galleries || []).filter((g) => g.name && isYes(g.show));
  for (const g of galleries.filter((x) => /^https?:\/\//i.test(x.website || '') && !/\bora\b|vault/i.test(x.name))) {
    linkCheck('Galleries', `${g.name}: website`, g.website, 'warn', 'Cate: update the Website in the Galleries tab.');
  }
  for (const e of (tabs.Exhibitions || []).filter((x) => x.title && isYes(x.show) && /^https?:\/\//i.test(x.link || ''))) {
    linkCheck('Exhibitions', `${e.title}: link`, e.link, 'warn', 'Cate: update the Link in the Exhibitions tab.');
  }
  const stocked = (re) => galleries.some((g) => re.test(g.name) && isYes(g.has_cate_s_work_now));

  tasks.push((async () => {
    try {
      const res = await fetch(ORA_FEED, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { products } = await res.json();
      const available = products.filter((p) => p.variants?.some((v) => v.available)).length;
      if (!available && stocked(/\bora\b/i)) add('Galleries', "ORA Gallery: Cate's pieces", 'warn', 'no pieces for sale at ORA, but the Galleries tab says ORA has Cate\'s work now', "Cate: if ORA really has none, set Has Cate's work now to no for ORA. If it does, ask Dom.");
      else add('Galleries', "ORA Gallery: Cate's pieces", 'ok', `${available} for sale`);
    } catch (err) {
      add('Galleries', "ORA Gallery: Cate's pieces", 'fail', `ORA's shop feed couldn't be read (${err.message})`, CODE_FIX);
    }
  })());

  tasks.push((async () => {
    try {
      const pieces = listPieces(await fetchText(ARTIST_PAGE));
      if (!pieces.length && stocked(/vault/i)) add('Galleries', "The Vault: Cate's pieces", 'fail', `no pieces could be read from ${ARTIST_PAGE}; either none are listed or The Vault changed its page layout`, `If Cate's pieces are on that page: ${CODE_FIX} If not: Cate, set Has Cate's work now to no for The Vault.`);
      else add('Galleries', "The Vault: Cate's pieces", 'ok', `${pieces.length} listed`);
    } catch (err) {
      add('Galleries', "The Vault: Cate's pieces", 'fail', `The Vault's website couldn't be read (${err.message})`, CODE_FIX);
    }
  })());

  await Promise.all(tasks);
  const order = ['Website', 'Google Sheet', 'Workshops', 'Announcements', 'Media', 'Studio', 'Galleries', 'Exhibitions'];
  return checks.sort((a, b) => order.indexOf(a.area) - order.indexOf(b.area));
}
