// Visitor stats with GoatCounter (https://figtreestudio.goatcounter.com): page views, where
// visitors came from and rough location/device. No cookies and nothing personal is stored.
// Only counts on the live site, so preview and local visits don't skew the numbers.
// The QR codes on the printed cards add ?ref=card / table / handout, which GoatCounter shows
// as the referrer. Booking-button clicks are counted as events (below).
if (location.hostname === 'catepates.co.nz' || location.hostname === 'www.catepates.co.nz') {
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = 'https://figtreestudio.goatcounter.com/count';
  document.head.append(s);

  // Clicks on workshop booking buttons (data-track, set by workshops.js and home.js) are
  // counted as GoatCounter events, e.g. "book/2026-11-07 Gin and Clay…", so you can see how
  // many people went from the website to Humanitix. Listening on the document catches buttons
  // drawn after the page loads.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-track]');
    if (a && window.goatcounter?.count) {
      window.goatcounter.count({ path: a.dataset.track, title: `Book now (${location.pathname === '/' ? 'home' : location.pathname.replace(/^\/|\.html$/g, '')})`, event: true });
    }
  });
}
