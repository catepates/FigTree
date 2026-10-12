// Homepage "Step inside the gallery" list: only the places that have Cate's work right now.
//   From Cate's studio / Prints: available rows in the Studio tab of the Sheet
//   ORA Gallery: ORA's live feed (falls back to the list from the last build)
//   The Vault: /api/vault (falls back to the list from the last build)
// Each line shows how many pieces are there. If nothing is available anywhere, the list
// hides and the text points to past work instead.

import { sheetRows, isYes } from './sheet.js';
import { keyOf, stockOf } from './studio.js';
import { typeOf } from './piece-type.js';

const list = document.querySelector('[data-where-to-buy]');
const lede = document.querySelector('[data-where-lede]');

const json = async (url) => {
  try {
    const res = await fetch(url);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
};

async function studioCounts() {
  const rows = (await sheetRows('Studio')) || [];
  const sales = (await json('/api/studio-sold'))?.counts || {};
  const available = rows
    .filter((r) => r.title && r.photo_link && isYes(r.show))
    .map((r) => ({ key: r.code, title: r.title, sold: r.sold, edition: r.edition, type: r.type }))
    .filter((p) => !stockOf(p, sales[keyOf(p)] || 0).sold);
  const prints = available.filter((p) => typeOf(p.title, [], p.type) === 'print').length;
  return { studio: available.length - prints, prints };
}

async function oraCount() {
  const feed = await json('https://oragallery.co.nz/collections/cate-pates/products.json?limit=250');
  if (feed?.products) return feed.products.filter((p) => p.variants?.[0]?.available && p.images?.length).length;
  return (await json('/data/ora.json'))?.pieces?.length || 0;
}

async function vaultCount() {
  const live = await json('/api/vault');
  if (live?.found) return live.pieces.length;
  return (await json('/data/vault.json'))?.pieces?.length || 0;
}

const pieces = (n) => `${n} piece${n === 1 ? '' : 's'}`;

function item(href, name, detail) {
  const li = document.createElement('li');
  const a = Object.assign(document.createElement('a'), { href });
  a.append(Object.assign(document.createElement('strong'), { textContent: name }),
    Object.assign(document.createElement('span'), { textContent: `${detail} →` }));
  li.append(a);
  return li;
}

if (list) {
  const [{ studio, prints }, ora, vault] = await Promise.all([studioCounts(), oraCount(), vaultCount()]);
  const items = [];
  if (studio) items.push(item('/work.html#studio', "From Cate's studio", `${pieces(studio)} · buy direct`));
  if (ora) items.push(item('/work.html#ora', 'ORA Gallery', `${pieces(ora)} · 23 Allen Street, Wellington`));
  if (vault) items.push(item('/work.html#vault', 'The Vault', `${pieces(vault)} · 2 Plimmer Steps, Wellington`));
  if (prints) items.push(item('/work.html#prints', 'Prints', `${prints} available · buy direct`));
  list.replaceChildren(...items);
  list.hidden = items.length === 0;
  if (lede) {
    lede.textContent = items.length
      ? "Where you can see and buy Cate's work right now, plus a look back at pieces that have already found a home."
      : 'Everything has found a home for now. New pieces go to the galleries as they come out of the kiln; in the meantime, here is a look back at past work.';
  }
}
