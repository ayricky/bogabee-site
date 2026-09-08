# Internal dashboard

`/internal/` contains Overview, Events, and Connections. It reports website page
views, sessions, popular pages, and traffic sources from the existing Google
Analytics property. Cloudflare provides separate network request, bandwidth, and
cache totals. Recorded check-ins come from HubSpot form submission history.
The event directory lives in Cloudflare D1 and generates guest, tablet, and QR links.

## Current status

- Dashboard UI and connectors are implemented and locally verified.
- HubSpot's production form and last-event contact property exist. Live API
  verification used a temporary form; email and phone submissions appeared in
  history after a short processing delay. See [event setup](EVENTS.md).
- D1 `bogabee-dashboard` exists; both migrations have been applied remotely.
- Google Tag Manager `GTM-MT39Z35D` already loads measurement tag `G-DFYST77KBP`.
  Its numeric GA4 property ID, property access, collection status, and available
  historical data are not yet verified. No tracking code was replaced.
- Cloudflare Access is not enabled in the current account. Its application and
  login flow must be configured before private data is available on the live site.
- The feature has not been deployed to the public website.

The navigable tailnet preview is
<https://ayrdevbox.tail429003.ts.net:8766/internal/>. It is explicitly labelled as
an isolated preview, saves only test event records, and has no account credentials.
Event submissions are disabled there. Missing data sources display an em dash,
not invented numbers or a zero total. Unit/browser fixtures include synthetic
numbers only to exercise rendering.

## Private access

Create a Cloudflare Access self-hosted application covering both
`bogabeeapiaries.com/internal*` and `bogabeeapiaries.com/api/internal/*`, with one
application audience. Permit email one-time-code login only for:

- `bogabeeapiaries@gmail.com`
- `ayrsoftwaredev@gmail.com`

Set `ACCESS_TEAM_DOMAIN` to the team's `*.cloudflareaccess.com` domain and
`ACCESS_AUD` to the application's audience. `DASHBOARD_EMAILS` repeats the explicit
allowlist at the server boundary. Do not add a bypass policy. Ensure public event
check-in and QR routes remain outside the Access application. Redirect alternative
public hosts to the canonical `https://bogabeeapiaries.com` origin before launch.

Every private API request verifies the signed Access JWT, issuer, audience,
expiry, and email. A plain email header is insufficient. Missing configuration
returns 503, and absent/invalid identity returns 401 before any private data is
read. Mutation requests must also originate from the same site. The public static
HTML shell contains no private records. Verify allowed and disallowed accounts,
logout, and direct API requests through both custom and Pages domains at launch.

The Cloudflare OAuth session available during development can manage Pages and
D1 but could not configure Access. Access must first be enabled by the account
owner and managed using credentials with appropriate Access permissions.

## Google Analytics connection

Ask the existing property administrator to grant `ayrsoftwaredev@gmail.com`
Administrator access and provide the numeric Property ID. The dashboard itself
needs only read access. Keep the existing property to retain its available history.

1. Enable the Google Analytics Data API in a Google Cloud project.
2. Create a dedicated service account for the dashboard. Give its email **Viewer**
   access to Bogabee's GA4 property in Analytics Property access management.
3. Set `GA_PROPERTY_ID` in the production Pages environment.
4. Store the service account JSON as the production secret
   `GA_SERVICE_ACCOUNT_JSON`. Never put it in the browser, git, or preview settings.
5. Compare the dashboard with GA reports for the same dates and hostnames after
   deployment. API access and real report compatibility remain to be tested once
   credentials are available.

The server signs a short-lived token with the `analytics.readonly` scope and
requests four GA reports. It filters to Bogabee's two public hostnames and excludes
`/internal` paths. GA dates use the property's timezone; the UI labels this
separately from New York dates used for check-ins. Sampling or thresholding is
reported when GA identifies it. Recent activity can take time to process.

## Data and operational limits

Event names are unique and immutable. Include a date for recurring markets.
Legacy `?event=...` URLs still work; creating a directory entry with the exact
historical name makes its form submissions match. The directory holds event names
and dates, not guest contact details. It currently lists the latest 200 events.
There is no edit/delete UI.

Check-in totals count retained form submissions, not unique people. A repeat
submission counts again; updating a contact's last-event field does not overwrite
history. The server reads up to 1,000 submissions per request and shows partial
counts when additional pages remain. Provider errors produce an unavailable state.
HubSpot spam filtering and processing delays can affect the retained history.
Guest details stay in HubSpot and are never returned by the dashboard overview API.

D1 migrations are versioned. The initial migration included unused custom traffic
storage during design; migration 0002 removes it in favor of existing Google
Analytics. No custom traffic collector was deployed. Apply all migrations in order:

```sh
npx wrangler d1 migrations apply bogabee-dashboard --remote
```

Production bindings are in `wrangler.jsonc`. Preview configuration has no private
source variables or D1 binding. Keep production secrets out of preview deployments.
See [EVENTS.md](EVENTS.md) for Pages build settings and public submission configuration.

## Verification and preview

Use Node 22 or later, `npm ci`, `npm test`, and `npm run test:browser`. Tests cover
JWT signatures and unauthorized access, event persistence, provider pagination,
GA report parsing and read-only authorization, missing-data states, QR links,
mobile layout, and expired sessions during refresh and event creation.

The server's user services `bogabee-preview` (Wrangler on localhost 8766) and
`bogabee-dashboard-preview` (wrapper on localhost 8772) serve the tailnet preview.
Tailscale HTTPS port 8766 proxies to the wrapper. `tools/dashboard-preview.mjs`
uses a separate local SQLite database under `.wrangler/`, provides no private
metrics, and is excluded from the Cloudflare build. Rebuild static assets with
`npm run build` after frontend edits; restart the wrapper after its server imports
change. Normal Wrangler preview intentionally keeps private APIs closed without
Access configuration.

References: [GA Data API setup](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart),
[Cloudflare Access JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/),
[HubSpot submission history](https://developers.hubspot.com/docs/api-reference/legacy/marketing/forms/v1/get-form-integrations-v1-submissions-forms-form_guid).

## Cloudflare traffic

The dashboard also reads Cloudflare's zone analytics independently of Google
Analytics. `CF_ZONE_ID` identifies the Bogabee zone in `wrangler.jsonc`.
Create a dedicated API token with **Zone / Analytics / Read**, restricted to
`bogabeeapiaries.com`, and save it as the Pages **production** secret
`CF_ANALYTICS_TOKEN`. Keep it out of preview environments and source control.

The existing Wrangler OAuth session successfully verified the actual connector
against Bogabee's live 7-, 30-, and 90-day history. It is a developer login, expires, and has
broader permissions, so it is not copied into the deployed application. This
session cannot create API tokens. The dedicated production token remains a
setup requirement until added by the account owner.

The report shows requests, response bandwidth, cache request percentage, and a
daily request chart. These are zone-wide network totals, including bots, static
assets, staff routes, and other proxied subdomains. They are not Google Analytics
sessions or unique visitors. Unlike the GA report, the daily zone dataset cannot
filter to specific paths or hostnames. Daily buckets use UTC on the same displayed
calendar date range; check-ins use New York time and GA uses its property timezone.
Recent totals can still change during processing.

The connector queries the `httpRequests1dGroups` dataset and checks its advertised
retention and query-duration limits before requesting data. Unsupported periods,
permission errors, malformed responses, and GraphQL errors inside HTTP 200
responses never become zero counts. A valid empty report is zero requests, with
no cache percentage when there are no requests. No visitor IP addresses are
queried or returned. The daily table provides the exact values behind the chart.

This report uses the existing protected overview API. Cloudflare Access setup
remains required for live private data, and the isolated tailnet preview remains
credential-free. Tests cover scope, totals, cache percentage, unavailable and
limited reports, and clearing stale charts when a session expires.

References: [Zone analytics API mapping](https://developers.cloudflare.com/analytics/graphql-api/migration-guides/zone-analytics/),
[dataset availability and limits](https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/),
[analytics token setup](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/).
