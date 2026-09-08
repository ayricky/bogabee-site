(() => {
  const $ = id => document.getElementById(id);
  const number = new Intl.NumberFormat('en-US');
  let overview = null;
  let events = [];
  let refreshVersion = 0;
  let accessExpired = false;
  let eventStorageReady = false;
  const dateLabel = day => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'America/New_York' }).format(new Date(`${day}T12:00:00Z`));
  const text = (id, value) => { $(id).textContent = value; };
  function navigate() {
    const tab = ['overview', 'events', 'connections'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.id !== tab; });
    document.querySelectorAll('[data-tab]').forEach(link => { if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
    const headings = { overview: ['Overview', 'Event check-ins and website traffic.'], events: ['Events', 'Guest links, QR codes, and attendance.'], connections: ['Connections', 'Manage data sources and staff sign-in.'] };
    text('page-title', headings[tab][0]); text('page-description', headings[tab][1]);
    $('create-event-shortcut').hidden = tab === 'events';
  }
  window.addEventListener('hashchange', navigate); navigate();

  async function request(path, options = {}) {
    const response = await fetch(path, { ...options, cache: 'no-store', signal: AbortSignal.timeout(120000) });
    const result = await response.json().catch(() => { throw Object.assign(new Error('Could not load the dashboard. Please refresh the page to sign in again.'), { status: response.status }); });
    if (!response.ok) {
      if (response.status === 401 || result.code === 'auth_unconfigured') {
        accessExpired = true;
        $('event-fields').disabled = true;
        text('access-status', 'Refresh the page to verify your workspace access.'); text('access-chip', 'Sign-in needed');
        text('access-message', result.error); $('access-message').hidden = false;
      }
      throw Object.assign(new Error(result.error || 'This information is temporarily unavailable.'), { status: response.status });
    }
    return result;
  }
  function links(event) {
    const fragment = document.createDocumentFragment();
    const urls = [['QR code', '/event-qr/'], ['Guest page', '/event/'], ['Tablet', '/event/']];
    for (const [label, path] of urls) {
      const link = document.createElement('a');
      const url = new URL(path, location.origin); url.searchParams.set('event', event.name);
      if (label === 'Tablet') url.searchParams.set('kiosk', '1');
      link.href = url.href; link.textContent = label; fragment.append(link);
    }
    return fragment;
  }
  function renderEvents() {
    const list = $('event-list'); list.replaceChildren();
    text('event-count', String(events.length));
    if (!events.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No events saved. Use the form to add one.'; list.append(empty); }
    for (const event of events) {
      const row = document.createElement('article'); row.className = 'event-row';
      const title = document.createElement('h3'); title.textContent = event.name;
      const date = document.createElement('p'); date.textContent = dateLabel(event.startsOn);
      const count = document.createElement('p'); count.className = 'count';
      const checkins = overview?.checkins;
      count.textContent = checkins && ['ready', 'partial'].includes(checkins.state)
        ? `${number.format(Object.hasOwn(checkins.counts, event.name) ? checkins.counts[event.name] : 0)}${checkins.state === 'partial' ? '+' : ''} recorded check-ins in this period`
        : 'Check-in counts are not available yet';
      const actions = document.createElement('div'); actions.className = 'event-actions'; actions.append(links(event));
      row.append(title, date, count, actions); list.append(row);
    }
    const today = overview?.range.end || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    const next = [...events].filter(event => event.startsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
    text('next-name', next?.name || 'No upcoming events');
    text('next-date', next ? dateLabel(next.startsOn) : 'Add an event to prepare its sign-in page and QR code.');
    $('next-calendar').hidden = !next;
    if (next) {
      const date = new Date(`${next.startsOn}T12:00:00Z`);
      text('next-month', new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'America/New_York' }).format(date));
      text('next-day', new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'America/New_York' }).format(date));
    }
    $('next-links').replaceChildren(); if (next) $('next-links').append(links(next));
  }
  function ranking(id, rows, state) {
    const list = $(id); list.replaceChildren();
    if (!rows?.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = state === 'ready' ? 'No activity in this period.' : 'Traffic data is not available yet.'; list.append(li); return; }
    for (const row of rows) {
      const li = document.createElement('li'); const label = document.createElement('span'); const count = document.createElement('strong');
      label.textContent = row.label; count.textContent = number.format(row.count); li.append(label, count); list.append(li);
    }
  }
  function chart(traffic) {
    const container = $('activity-chart'); container.replaceChildren(); $('daily-table').replaceChildren();
    container.hidden = traffic.state !== 'ready';
    $('traffic-breakdown').hidden = traffic.state !== 'ready';
    $('daily-details').hidden = traffic.state !== 'ready';
    if (traffic.state !== 'ready' || !traffic.pageviews) { container.textContent = traffic.state === 'ready' ? 'No page views in this period.' : traffic.state === 'unavailable' ? 'Traffic report unavailable. Try again later.' : 'Google Analytics is not connected.'; }
    if (traffic.state !== 'ready') return;
    for (const row of traffic.daily) { const tr = document.createElement('tr'); for (const value of [dateLabel(row.day), number.format(row.count)]) { const cell = document.createElement('td'); cell.textContent = value; tr.append(cell); } $('daily-table').append(tr); }
    if (!traffic.pageviews) return;
    drawChart(container, traffic.daily, 'page views');
  }
  function drawChart(container, daily, metric) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 600 190'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `Daily ${metric}. Exact totals are in the table below.`);
    const maximum = Math.max(...daily.map(row => row.count), 1); const width = 600 / daily.length;
    daily.forEach((row, index) => { const bar = document.createElementNS(ns, 'rect'); const height = row.count / maximum * 160; bar.setAttribute('x', String(index * width + 1)); bar.setAttribute('y', String(165 - height)); bar.setAttribute('width', String(Math.max(1, width - 3))); bar.setAttribute('height', String(height)); bar.setAttribute('rx', '2'); const title = document.createElementNS(ns, 'title'); title.textContent = `${dateLabel(row.day)}: ${row.count} ${metric}`; bar.append(title); svg.append(bar); });
    for (const [day, x, anchor] of [[daily[0].day, 0, 'start'], [daily.at(-1).day, 600, 'end']]) { const label = document.createElementNS(ns, 'text'); label.setAttribute('x', x); label.setAttribute('y', '188'); label.setAttribute('text-anchor', anchor); label.textContent = dateLabel(day); svg.append(label); }
    container.append(svg);
  }
  function renderCloudflare(report) {
    const ready = report.state === 'ready';
    const message = ready ? 'Daily totals in UTC for the entire Bogabee zone. Includes bots, assets, and proxied subdomains. Recent totals may still update.'
      : report.state === 'limited' ? `This period exceeds Cloudflare's ${report.maxDays}-day history limit. Choose a shorter period.`
      : report.state === 'unconfigured' ? 'Connect Cloudflare to see requests, bandwidth, and cache usage.'
      : report.state === 'loading' ? 'Loading Cloudflare traffic...'
      : 'Cloudflare traffic could not be loaded. Check the connection and try again.';
    text('cloudflare-message', message); text('cloudflare-status', message);
    text('cloudflare-chip', ready ? 'Connected' : report.state === 'unconfigured' ? 'Not connected' : report.state === 'limited' ? 'Period too long' : report.state === 'loading' ? 'Loading' : 'Unavailable');
    $('cloudflare-metrics').hidden = !ready; $('cloudflare-chart').hidden = !ready; $('cloudflare-daily-details').hidden = !ready;
    $('cloudflare-chart').replaceChildren(); $('cloudflare-daily-table').replaceChildren();
    for (const id of ['cf-requests', 'cf-bytes', 'cf-cache']) text(id, '—');
    if (!ready) return;
    const unit = Math.min(4, Math.floor(Math.log10(Math.max(1, report.bytes)) / 3));
    text('cf-requests', number.format(report.requests));
    text('cf-bytes', `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(report.bytes / 1000 ** unit)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`);
    text('cf-cache', report.cacheRate === null ? '—' : new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(report.cacheRate));
    for (const row of report.daily) {
      const tr = document.createElement('tr');
      for (const value of [dateLabel(row.day), number.format(row.count)]) { const cell = document.createElement('td'); cell.textContent = value; tr.append(cell); }
      $('cloudflare-daily-table').append(tr);
    }
    if (report.requests) drawChart($('cloudflare-chart'), report.daily, 'requests');
    else text('cloudflare-chart', 'No requests in this period.');
  }
  function renderOverview(result) {
    overview = result;
    const { traffic, checkins, range } = result;
    renderCloudflare(result.cloudflare);
    text('period-description', `${dateLabel(range.start)} – ${dateLabel(range.end)} · Check-ins: New York time${traffic.state === 'ready' ? ` · Traffic: ${traffic.timeZone}` : ''}`);
    text('identity', result.identity?.email || 'Private workspace');
    $('preview-banner').hidden = !result.preview;
    $('logout').hidden = Boolean(result.preview);
    text('pageviews', traffic.state === 'ready' ? number.format(traffic.pageviews) : '—');
    text('sessions', traffic.state === 'ready' ? number.format(traffic.sessions) : '—');
    text('pageviews-note', traffic.state === 'ready' ? 'Public website page loads' : 'Traffic not connected');
    text('sessions-note', traffic.state === 'ready' ? 'Sessions reported by Google Analytics' : 'Google Analytics not connected');
    const recorded = ['ready', 'partial'].includes(checkins.state);
    text('checkins', recorded ? `${number.format(checkins.total)}${checkins.state === 'partial' ? '+' : ''}` : '—');
    text('checkins-note', checkins.state === 'partial' ? 'Partial history; more submissions exist' : recorded ? 'Form submissions, not unique guests' : checkins.state === 'unavailable' ? 'HubSpot could not be reached' : 'HubSpot not connected');
    text('traffic-message', traffic.state === 'ready' ? `From Google Analytics. Recent visits may still be processing.${traffic.limited ? ' Google has applied sampling or reporting limits to this data.' : ''}` : traffic.state === 'unavailable' ? 'Google Analytics could not be reached. Check the connection and try again.' : 'Connect the existing Google Analytics property to see traffic and available history.');
    text('metrics-status', $('traffic-message').textContent); text('metrics-chip', traffic.state === 'ready' ? 'Connected' : traffic.state === 'unavailable' ? 'Unavailable' : 'Not connected');
    text('hubspot-status', recorded ? 'Connected. Event submissions are available.' : checkins.state === 'unavailable' ? 'Connection could not be verified. Please try again later.' : 'Not connected yet.');
    $('hubspot-link').hidden = !result.hubspotUrl; if (result.hubspotUrl) $('hubspot-link').href = result.hubspotUrl;
    text('access-status', result.preview ? 'This is an isolated preview. Live private access is still pending.' : `Signed in as ${result.identity.email}.`); text('access-chip', result.preview ? 'Preview' : 'Protected');
    text('event-counts-note', checkins.state === 'partial' ? `Only a portion of HubSpot history is shown${checkins.oldest ? `, back to ${new Date(checkins.oldest).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}` : ''}. Counts are minimums.` : `Recorded check-ins from ${dateLabel(range.start)} to ${dateLabel(range.end)}. Repeated submissions count separately.`);
    ranking('sources', traffic.sources, traffic.state); ranking('pages', traffic.pages, traffic.state); chart(traffic); renderEvents();
  }
  async function loadOverview() {
    const version = ++refreshVersion;
    overview = null;
    renderCloudflare({ state: 'loading' });
    for (const id of ['pageviews', 'sessions', 'checkins']) text(id, '—');
    text('period-description', 'Loading the selected period...');
    text('activity-chart', 'Loading...'); $('daily-details').hidden = true; $('traffic-breakdown').hidden = true;
    ranking('sources', [], 'loading'); ranking('pages', [], 'loading'); renderEvents();
    try { const result = await request(`/api/internal/overview?days=${$('period').value}`); if (version === refreshVersion) { $('access-message').hidden = true; renderOverview(result); } }
    catch (error) {
      if (version !== refreshVersion) return;
      text('access-message', error.message); $('access-message').hidden = false;
      renderCloudflare({ state: 'unavailable' });
      text('period-description', 'This period could not be loaded.'); text('activity-chart', 'Activity is temporarily unavailable.');
      for (const id of ['pageviews-note', 'sessions-note', 'checkins-note']) text(id, 'Not available');
      text('traffic-message', 'Refresh the page or try another period.');
      text('hubspot-status', 'Connection status could not be checked.'); $('hubspot-link').hidden = true;
      text('metrics-status', 'Connection status could not be checked.'); text('metrics-chip', 'Unknown');
    }
  }
  async function loadEvents() {
    try {
      const result = await request('/api/internal/events'); events = result.events;
      eventStorageReady = result.state === 'ready';
      $('event-fields').disabled = !eventStorageReady || accessExpired;
      $('event-storage-note').hidden = result.state === 'ready';
      text('event-storage-note', 'Event storage is not available yet.'); renderEvents();
    } catch (error) { $('event-storage-note').hidden = false; text('event-storage-note', error.message); }
  }
  $('period').addEventListener('change', loadOverview);
  $('event-form').addEventListener('submit', async event => {
    event.preventDefault(); $('event-error').hidden = true; $('event-fields').disabled = true; text('save-event', 'Saving...');
    try { await request('/api/internal/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: $('event-name').value, startsOn: $('event-date').value }) }); $('event-form').reset(); await loadEvents(); }
    catch (error) { text('event-error', error.message); $('event-error').hidden = false; }
    finally { $('event-fields').disabled = !eventStorageReady || accessExpired; text('save-event', 'Create event'); }
  });
  loadOverview(); loadEvents();
})();
