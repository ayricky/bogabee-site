# Event sign-in

Guest link: `/event/?event=Fall%20Market%20September%2019`.
Tablet link: add `&kiosk=1`. Successful sign-ins clear immediately and return
to the form after eight seconds. After a server error, thirty seconds without
activity clears the form. The next-guest button resets it immediately.

Open `/event-qr/` to generate a QR code, download its SVG, print a table sign,
or open tablet mode. Use the public production domain when generating final
QR codes. Include a date in event names to distinguish repeat events.

## HubSpot setup

Bogabee's account is connected for setup. The `bogabee_last_event` property and
“Bogabee event sign-in” form have been created. The production account and form
IDs are in `wrangler.jsonc`; the token is stored separately as a Cloudflare Pages
production secret. Neither the new event page nor dashboard has been deployed.

The actual submission handler was verified against Bogabee's account using a
temporary form: email and phone-only guests became leads, and both submissions
appeared in the form-history API after five seconds. Temporary contacts and the
verification form were archived afterward; the production form was retained.
HubSpot search indexing also lagged, so immediate search results are not proof
of a missing contact. Browser tests use an isolated substitute account.

The following describes the configuration for maintenance or a replacement account:

1. Create the contact property `bogabee_last_event`, a single-line text field
   labelled “Last Bogabee event”. It stores the most recent event. The form's
   submission history records individual visits.
2. Create a dedicated “Bogabee event sign-in” HubSpot form with `firstname`,
   `lastname`, `email`, `phone`, and `bogabee_last_event`. Include the event field
   as a hidden field. Allow email and phone to be optional in HubSpot; the site
   requires at least one. Allow phone numbers with 7–15 digits. Disable form
   pre-population and enable creation of contacts for new email addresses.
   Leave the account-level “Allow submissions without email addresses to create
   contacts” setting **off**. The server already creates phone-only contacts;
   enabling that setting can create an extra contact for each form submission.
   Do not configure a lifecycle-stage override on the form. The server sets
   `lead` only when it creates a contact and preserves stages on updates.
3. Configure a server access token for this Bogabee account with `forms`,
   `crm.objects.contacts.read`, and `crm.objects.contacts.write` scopes. Use an
   account-specific private app token or a supported app's managed access token.
   Expiring access tokens require refresh outside this handler.
4. Register the live site domain in HubSpot's additional site domains and check
   form spam settings. Do not enable CAPTCHA on a form receiving these API
   submissions without adding a compatible validation flow.
5. Set the following variables in the Cloudflare Pages **production** environment.
   Store the token as a secret. Set `EVENT_ALLOWED_ORIGIN` to the exact canonical
   origin, including `https://` and no trailing slash. Redirect alternate domains
   to it. Leave preview credentials unset, or use a separate test HubSpot account.

   ```text
   HUBSPOT_TOKEN
   HUBSPOT_PORTAL_ID
   HUBSPOT_EVENT_FORM_ID
   EVENT_ALLOWED_ORIGIN
   ```

6. Before launch, verify the account-level settings above in HubSpot. Then submit
   a designated email test guest and a phone-only test guest on
   the live domain, and inspect both the actual CRM contacts and the event form's
   submissions. Repeat an existing customer and check that its lifecycle stage
   stays unchanged. Check the spam view too: an accepted request alone does not
   prove HubSpot retained the form submission outside spam.

“Lead” here means a contact with lifecycle stage `lead`, matching the intended
contact-capture flow. This does not create HubSpot's separate Sales Lead object,
subscribe guests to marketing, or configure emails, SMS, deals, or workflows.
The page explains attendance and event follow-up use. Any newsletter or SMS
subscription needs the client's wording and a separate subscription setup.

## Cloudflare Pages

The existing homepage stays static. Build with `npm ci && npm run build`, set
the build output directory to `dist`, and keep `functions/` at the repository
root. Cloudflare compiles `functions/api/event-check-in.js` separately. The
build copies only public assets and pages, excluding tests, docs, and secrets.
The build command in Pages can be `npm run build` when dependency installation
is automatic. Use Node 22 or later. The existing Cloudflare Pages project was
verified as `bogabee-site`, with Git integration and domains
`bogabeeapiaries.com`, `www.bogabeeapiaries.com`, and `bogabee-site.pages.dev`.
Its build settings now use `npm run build` and `dist` for future deployments.
The current public production site has not been redeployed with these features.

For local preview:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run dev
```

Open `http://localhost:8766/event/?event=Test%20market`. Blank credentials show
an unavailable form. Use only a test account if adding local credentials.
GET `/api/event-check-in` checks configuration presence and origin, not token
validity or HubSpot reachability. POST validates again before any CRM writes.

## Implementation and verification

The browser sends one fixed-schema request to the Pages Function. The function
matches contacts by email, or by normalized phone for phone-only entries, then
creates or updates the contact and posts to HubSpot's authenticated Forms API.
It confirms only after both operations succeed. It never sends a browser tracking
cookie. More than one phone match asks the guest for email instead of choosing
someone's record. Phone normalization follows the One Stop implementation's
US country-code handling; test other countries before relying on phone matching.
Phone-only submissions remain in the form's submission history, but HubSpot does
not automatically attach them to the matched contact's activity timeline. The
contact still receives the latest-event property through the server's CRM write.

These are two upstream writes, not a transaction. If the form write fails, the
contact may already exist. Retrying normally reuses it, but phone search indexing
can lag, and repeated or timed-out form submissions can produce duplicate visits.
There is no offline queue or durable submission deduplication. Guests should ask
the host to check an interrupted submission before retrying. Configure public
endpoint abuse controls in Cloudflare as traffic requires; origin checks alone
do not authenticate visitors.

Run `npm test` for endpoint tests and `npm run test:browser` for the browser flow,
mobile layout, kiosk reset, QR decoding, and failure states. Browser tests run
the real handler against an in-memory HubSpot substitute. They never use account
credentials or send requests to a live CRM.

Design choice: two sketches converged on one server submission path. The chosen
design combines the server-owned configuration and lifecycle rules from candidate
B with candidate A's QR, kiosk, and form-submission history. An Astra high review
agreed. A browser Forms API plus separate phone endpoint was rejected because it
splits error handling and account configuration across browser and server.

References: [One Stop event flow](https://github.com/ayricky/onestopgroup-us/blob/c57f337ca42199862b644bc3563956ef0ee88a6e/site/js/event-page.js),
[HubSpot authenticated form submissions](https://developers.hubspot.com/docs/api-reference/legacy/marketing/forms/v3-legacy/submit-data-authenticated),
[HubSpot contacts](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide),
[email-less form contact creation](https://knowledge.hubspot.com/forms/how-can-i-allow-form-submissions-without-email-addresses-to-create-contacts-in-hubspot).
