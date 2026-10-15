// Website announcements, from the Announcements tab of Cate's Google Sheet.
// Each row: Heading, Details, Label, Button text, Link, Start, End, Pages, Show.
// A row shows (as a slim band under the header) while Show is yes and
// today (NZ time) is between Start and End. Start and End are optional; with an End
// date the announcement disappears by itself the day after. Several current rows stack,
// soonest-ending first. Pages: "All pages", or anything else (or blank) = the home page only.

import { sheetRows, isYes } from './sheet.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter(Boolean));
  return node;
}

function band(a) {
  const text = el('p', { className: 'announce-text' },
    a.label ? el('span', { className: 'announce-label', textContent: a.label }) : null,
    el('strong', { textContent: a.heading }),
    a.details ? el('span', { className: 'announce-details', textContent: a.details }) : null);
  const link = /^https?:\/\//.test(a.link || '')
    ? el('a', { className: 'announce-link', href: a.link, textContent: `${a.button_text || 'Find out more'} →` })
    : null;
  const aside = el('aside', { className: 'announce' }, el('div', { className: 'wrap announce-inner' }, text, link));
  aside.setAttribute('aria-label', 'Announcement');
  return aside;
}

const header = document.querySelector('.site-header');
const isHome = location.pathname === '/' || location.pathname === '/index.html';
const rows = header ? await sheetRows('Announcements') : null;
if (rows) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' });
  const current = rows
    .filter((a) => a.heading && isYes(a.show))
    .filter((a) => /^all/i.test(String(a.pages || '').trim()) || isHome)
    .filter((a) => !ISO.test(a.start || '') || a.start <= today)
    .filter((a) => !ISO.test(a.end || '') || a.end >= today)
    .sort((a, b) => String(a.end || '9999').localeCompare(String(b.end || '9999')));
  header.after(...current.map(band));
}
