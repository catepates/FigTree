// Visitor stats with GoatCounter (https://figtreestudio.goatcounter.com): page views, where
// visitors came from and rough location/device. No cookies and nothing personal is stored.
// Only counts on the live site, so preview and local visits don't skew the numbers.
// The QR codes on the printed cards add ?ref=card / table / handout, which GoatCounter shows
// as the referrer.
if (location.hostname === 'catepates.co.nz' || location.hostname === 'www.catepates.co.nz') {
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = 'https://figtreestudio.goatcounter.com/count';
  document.head.append(s);
}
