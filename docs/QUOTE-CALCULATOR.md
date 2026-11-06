# Party favors quote calculator

A customer builds a party-favor order on the site, sees the price as they go,
and either pays right away or sends it to Bogabee for approval. This replaces
quoting over Instagram DMs.

Demo: `demos/favors/` (customer) and `demos/hub/quotes.html` (owner). Pricing
lives in `demos/favors/pricing.js`. The prices come from the party-favors
wizard in PR #3.

## Inputs

| Input | Values | Rule |
| --- | --- | --- |
| Jar | Mini 2 oz, Small 4 oz, Classic 8 oz | Required. Small is preselected. |
| Quantity | Whole number | At least 10. The stepper moves in fives; quick picks are 25, 50, 100 and 150. Anything typed below 10 becomes 10. |
| Add-ons | Honey dipper, Charm, Ribbon, Twine, Custom label | Any combination, priced per jar. |
| Label text | Up to 60 characters | Required when Custom label is picked. |
| Assembly | Assembled, DIY kit | Assembled is the default. |
| Event type | Wedding, Baby shower, Bridal shower, Birthday party, Corporate event, Holiday party, Other | Required. |
| Event date | Date | Required. Must be after today. |
| Color | Gold, Blush, Sage, Navy, White, Lavender, Burgundy, or a custom hex | Optional. |
| Logo or monogram | PNG, JPG, SVG or PDF | Optional. |
| Notes | Free text | Optional. |
| Name, email, phone | | All required. Email must look like an address. Phone must have 10 digits (a leading 1 is ignored). |

Errors appear under the field that caused them and clear as soon as it's fixed.
On submit, the page moves to the first field with a problem.

## Pricing

All amounts are stored in cents.

| Item | Per jar |
| --- | --- |
| Mini jar (2 oz) | $3.00 |
| Small jar (4 oz) | $5.00 |
| Classic jar (8 oz) | $8.00 |
| Honey dipper | $1.50 |
| Charm | $1.00 |
| Ribbon | $0.75 |
| Twine | $0.50 |
| Custom label | $1.00 |
| Assembled | $1.00 |
| DIY kit | $0.00 |

```
per jar = jar + sum(add-ons) + assembly
total   = per jar × quantity
```

Examples:

- Small, 25, assembled, no add-ons: (5 + 1) × 25 = **$150**
- Classic, 100, dipper and ribbon, DIY kit: (8 + 1.50 + 0.75) × 100 = **$1,025**
- Mini, 35, dipper, ribbon and twine, assembled: (3 + 1.50 + 0.75 + 0.50 + 1) × 35 = **$236.25**

PR #3 showed jar prices without assembly and added $1 back in. Here assembly is
its own line, so the customer sees the same total with a clearer breakdown.

## Pay now, or approval first

Anything printed to order has to be checked before printing.

- **No custom label and no logo:** the button reads "Pay $X". The customer pays
  in a payment sheet and the quote is saved as **Paid**.
- **Custom label or logo:** the button reads "Send for approval". The quote is
  saved as **New**. The owner checks it and approves it, and the customer gets a
  payment link by email. When they pay, it becomes **Paid**.

Statuses: `new` → `approved` → `paid`. A quote that never needed approval goes
straight to `paid`.

## Data model

One row per quote (D1 table `favor_quotes` in production).

```
id            text     "Q-7K2M"
created_at    integer  ms since epoch
status        text     new | approved | paid
jar           text     mini | small | classic
qty           integer
addons        text     JSON array: ["dipper", "label"]
assembly      text     assembled | diy
label_text    text
logo_key      text     R2 object key for the upload, if any
event_type    text
event_date    text     YYYY-MM-DD
color         text     name or #hex
notes         text
name, email, phone   text
per_jar       integer  cents, computed by the server
total         integer  cents, computed by the server
approved_at   integer
pay_link      text     Stripe Checkout URL, set on approval
paid_at       integer
stripe_session text
```

## Payment

Stripe, called from Cloudflare Pages Functions (the site already deploys on
Pages, per PR #4).

1. The browser posts the choices to `POST /api/favors/quote`. It never sends a
   price. The function validates every input, **recomputes the price from its
   own copy of the table**, and stores the quote.
2. **Pay now:** the function creates a Stripe Checkout Session for the server
   total and returns its URL. Checkout covers card, Apple Pay, Google Pay and
   Link. Alternatively, the Payment Element can be embedded so the customer
   never leaves the page (this is what the demo's payment sheet imitates).
3. **Approval:** when the owner approves in the hub, the function creates a
   Checkout Session (or a Stripe Payment Link) for the stored total and emails
   it to the customer.
4. A Stripe webhook (`checkout.session.completed`, signature verified) marks the
   quote paid. The success page alone is not proof of payment.
5. Uploaded logos go to R2 under a random key, with a size limit of 10 MB and an
   allowlist of types. The hub shows them with a download link; they are never
   served inline from the public site.

Secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) are Pages production
secrets. Preview environments use Stripe test mode.

## Owner hub

`/hub/quotes.html`, behind the same Cloudflare Access login as the rest of the
hub.

- Counts: waiting on approval, approved but unpaid, paid, and the paid total.
- A list filtered by status: customer, event, jars, total, status.
- Every choice for the selected quote, including label text, logo and color, as
  well as contact links.
- **Approve and send payment link** for a new quote. **Copy** the link. **Mark
  paid** for payments taken another way (cash, Venmo).

## Notifications

- Customer: email on submit ("we have your quote" or a receipt), email with the
  payment link on approval, receipt on payment.
- Owner: email (and optionally SMS) when a quote needs approval and when one is
  paid.
- Email through the existing provider or Cloudflare Email Routing. If HubSpot is
  connected (PR #4), the customer can be upserted as a contact with the event
  date.

## Open questions for the owner

1. **Full payment or a deposit?** The demo charges the full amount. A deposit (for
   example 50%) with the balance before pickup is common for large orders.
2. **Lead time.** What's the shortest notice you'll take? Is there a rush fee? The
   demo only blocks past dates.
3. **Pickup or delivery for favors?** Porch pickup, local delivery or shipping, and
   at what fees?
4. **Sales tax.** Honey is food and New Jersey doesn't tax it, but charms,
   ribbons and dippers may be taxable. Check with an accountant before launch.
5. **Volume discounts.** Should large orders, such as 100+ jars, get a lower per-jar
   price?
6. **Stock.** Is there a cap per harvest, or a maximum order size you can fill?
7. **Cancellations and refunds.** What's the policy once labels are printed?
