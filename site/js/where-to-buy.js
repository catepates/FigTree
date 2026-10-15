// Homepage "Step inside the gallery" list: only the places that have Cate's work right now.
//   From Cate's studio / Prints: available rows in the Studio tab of the Sheet
//   Galleries: rows of the Galleries tab with "Has Cate's work now" = yes, in sheet order,
//     each linking to its Website. ORA and The Vault (matched by name) also get a live
//     piece count, from ORA's feed and /api/vault (else the lists from the last build),
//     and drop off by themselves when that count is 0.
// If nothing is available anywhere, the list hides and the text points to past work.
//
// The three photos beside the list are pieces for sale at those galleries right now (a
// creature, a vessel and a house where possible, picked afresh on each visit), using the
// framed photos from the last build. With nothing for sale they stay as past work.

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

// Pieces for sale now: the live list where it can be read (its count is the gallery's count),
// and the built pieces still in it, which have the framed photos.
async function galleryStock(live, builtUrl) {
  const built = (await json(builtUrl))?.pieces || [];
  if (!live) return { count: built.length, photos: built };
  const handles = new Set(live);
  return { count: live.length, photos: built.filter((p) => handles.has(p.handle)) };
}

async function oraStock() {
  const feed = await json('https://oragallery.co.nz/collections/cate-pates/products.json?limit=250');
  const live = feed?.products?.filter((p) => p.variants?.[0]?.available && p.images?.length).map((p) => p.handle);
  return galleryStock(live, '/data/ora.json');
}

async function vaultStock() {
  const live = await json('/api/vault');
  return galleryStock(live?.found ? live.pieces.map((p) => p.handle) : null, '/data/vault.json');
}

// Up to three photos: one creature, one vessel, one house if there are any, then the rest.
function pickPhotos(pool) {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const picked = [];
  for (const type of ['creature', 'vessel', 'house']) {
    const p = shuffled.find((x) => x.type === type && !picked.includes(x));
    if (p) picked.push(p);
  }
  for (const p of shuffled) if (picked.length < 3 && !picked.includes(p)) picked.push(p);
  return picked;
}

function showPhotos(pool) {
  const collage = document.querySelector('[data-gallery-collage]');
  const picked = pickPhotos(pool);
  if (!collage || picked.length < 3) return;
  collage.href = '/work.html';
  collage.setAttribute('aria-label', "See Cate's work for sale now");
  collage.querySelectorAll('img').forEach((img, i) => {
    img.src = `/${picked[i].image}`;
    img.alt = picked[i].alt || picked[i].title;
  });
}

const pieces = (n) => `${n} piece${n === 1 ? '' : 's'}`;

function item(href, name, detail) {
  const li = document.createElement('li');
  const a = Object.assign(document.createElement(href ? 'a' : 'div'), href ? { href } : {});
  a.append(Object.assign(document.createElement('strong'), { textContent: name }),
    Object.assign(document.createElement('span'), { textContent: href ? `${detail} →` : detail }));
  li.append(a);
  return li;
}

if (list) {
  const [{ studio, prints }, galleries, oraNow, vaultNow] = await Promise.all([
    studioCounts(), sheetRows('Galleries'), oraStock(), vaultStock(),
  ]);
  const ora = oraNow.count;
  const vault = vaultNow.count;
  const items = [];
  const photos = [];
  if (studio) items.push(item('/work.html#studio', "From Cate's studio", `${pieces(studio)} · buy direct`));
  for (const g of galleries || []) {
    if (!g.name || !isYes(g.has_cate_s_work_now)) continue;
    const website = /^https?:\/\//.test(g.website || '') ? g.website : '';
    if (/\bora\b/i.test(g.name)) {
      if (ora) items.push(item('/work.html#ora', g.name, [pieces(ora), g.place].filter(Boolean).join(' · ')));
      if (ora) photos.push(...oraNow.photos);
    } else if (/vault/i.test(g.name)) {
      if (vault) items.push(item('/work.html#vault', g.name, [pieces(vault), g.place].filter(Boolean).join(' · ')));
      if (vault) photos.push(...vaultNow.photos);
    } else {
      items.push(item(website, g.name, g.place || 'See the gallery'));
    }
  }
  if (prints) items.push(item('/work.html#prints', 'Prints', `${prints} available · buy direct`));
  list.replaceChildren(...items);
  showPhotos(photos);
  list.hidden = items.length === 0;
  if (lede) {
    lede.textContent = items.length
      ? "Where you can see and buy Cate's work right now, plus a look back at pieces that have already found a home."
      : 'Everything has found a home for now. New pieces go to the galleries as they come out of the kiln; in the meantime, here is a look back at past work.';
  }
}
