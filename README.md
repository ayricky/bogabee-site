# Bogabee Apiaries

Bogabee's public website, event check-in pages, and private dashboard, hosted on
Cloudflare Pages.

- `/` — existing public website.
- `/event/?event=Your%20Event` — guest check-in; add `&kiosk=1` for a shared tablet.
- `/event-qr/` — printable QR sign and SVG download.
- `/internal/` — event directory, HubSpot check-in totals, and Google Analytics reports.

The HubSpot form and contact property are created and API-tested. The internal
page is ready to preview; production Access login and Google Analytics access
still need configuration. These additions have not been deployed to the public site.

## Development

Use Node 22 or later:

```sh
npm ci
npm run dev
```

Open `http://localhost:8766`. Without account configuration, public submissions
and private APIs stay unavailable. Use only test credentials in `.dev.vars`.
The existing homepage uses Tailwind CSS via CDN; event and dashboard styles are local.

```sh
npm test
npm run test:browser
npm run build
```

Cloudflare Pages should build with `npm run build`, publish `dist/`, and compile
the root `functions/` directory. Secrets, tools, tests, and documentation are
excluded from public assets.

See [event setup](docs/EVENTS.md) and [dashboard setup](docs/DASHBOARD.md) for
account settings, production dependencies, data limitations, and verification.

The server's isolated dashboard preview is available at
<https://ayrdevbox.tail429003.ts.net:8766/internal/> while connected to the tailnet.

Instagram: [@bogabee_apiaries](https://www.instagram.com/bogabee_apiaries/).
