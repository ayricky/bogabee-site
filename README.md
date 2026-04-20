# Bogabee Apiaries

A static website for Bogabee Apiaries — small-batch, raw honey from Manalapan Township, NJ. Hosted on Cloudflare Pages.

## Structure

```
├── index.html              # Home page
├── about.html              # About Us page
├── party-favors.html       # Party favors order wizard (4-step form)
├── functions/
│   └── api/
│       └── order.js        # Cloudflare Pages Function (POST /api/order)
├── google-apps-script.js   # Google Apps Script code (deploy separately)
├── assets/
│   ├── bee.css             # Animated bee styles
│   ├── bee.js              # Bee cursor-following behavior
│   ├── logo.png
│   └── *.jpg               # Product and lifestyle images
└── README.md
```

## Development

Open `index.html` in a browser to preview the site. The site uses:
- **Tailwind CSS** via CDN
- **DM Serif Display + Inter** fonts via Google Fonts
- **Cloudflare Pages** for hosting (auto-deploys from GitHub)

### Bee Animation

The interactive bee that follows the cursor is modularized into:
- `assets/bee.css` — Styling and wing animation
- `assets/bee.js` — Cursor tracking and hover behavior

---

## Party Favors Order Pipeline

The party favors page has a multi-step order wizard. When a customer submits an order, the data flows through a secure pipeline:

```
Browser (party-favors.html)
    ↓  POST /api/order (JSON)
Cloudflare Pages Function (functions/api/order.js)
    ↓  Validates Turnstile, checks honeypot, validates fields
    ↓  POST (JSON)
Google Apps Script (Web App)
    ↓  Writes row to Google Sheet
    ↓  Sends HTML email notification
    ↓
Google Sheet + Gmail → bogabeeapiaries@gmail.com
```

### Security Layers

| Layer | What It Does |
|-------|-------------|
| **Cloudflare Turnstile** | Invisible CAPTCHA alternative — verifies the user is human (free) |
| **Honeypot field** | Hidden form field that bots fill but humans don't see. Silently discards bot submissions |
| **Server-side validation** | The Cloudflare Function validates required fields, email format, and minimum quantity |
| **Environment variables** | Turnstile secret key and Google Script URL are stored as Cloudflare env vars — never exposed in client-side code |
| **CORS headers** | The API endpoint only accepts POST requests |

---

## Setup Guide

### 1. Google Sheet

1. Create a new Google Sheet at [sheets.google.com](https://sheets.google.com)
2. Name it something like "Bogabee Party Favor Orders"
3. Copy the **Sheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
                                           ^^^^^^^^^^^^^^
   ```
4. The "Orders" tab and headers will be created automatically on the first submission

### 2. Google Apps Script

1. Go to [script.google.com](https://script.google.com) and click **New project**
2. Delete the default code and paste the contents of `google-apps-script.js`
3. Update the configuration at the top:
   ```javascript
   const SHEET_ID = 'your-actual-sheet-id-here';
   const SHEET_NAME = 'Orders';
   const NOTIFY_EMAIL = 'bogabeeapiaries@gmail.com';
   ```
4. Click **Deploy → New deployment**
5. Choose type: **Web app**
6. Settings:
   - **Description:** "Party favor order handler"
   - **Execute as:** Me (your Google account)
   - **Who has access:** Anyone
7. Click **Deploy** and authorize when prompted
8. Copy the **Web App URL** — you'll need it for Cloudflare

> **To test:** Click `testDoPost` in the script editor and run it. Check your Sheet and email.

> **To update:** After code changes, click Deploy → Manage deployments → Edit (pencil icon) → New version → Deploy

### 3. Cloudflare Turnstile

1. Go to [Cloudflare Dashboard → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. Click **Add widget**
3. Settings:
   - **Name:** "Bogabee Party Favors"
   - **Domains:** Add your domain (e.g., `bogabeeapiaries.com`)
   - **Widget Mode:** Managed (recommended) or Invisible
   - **Pre-clearance:** No
4. After creation, you'll get:
   - **Site Key** (public) — goes in `party-favors.html`
   - **Secret Key** (private) — goes in Cloudflare env vars
5. Update the site key in `party-favors.html`:
   ```html
   <div class="cf-turnstile" data-sitekey="YOUR_ACTUAL_SITE_KEY" ...></div>
   ```
   Replace `YOUR_SITE_KEY` with the actual site key from step 4.

### 4. Cloudflare Environment Variables

1. Go to [Cloudflare Dashboard → Pages](https://dash.cloudflare.com/?to=/:account/pages)
2. Click on your **bogabee-site** project
3. Go to **Settings → Environment variables**
4. Add these variables for **Production** (and optionally Preview):

   | Variable Name | Value | Type |
   |--------------|-------|------|
   | `TURNSTILE_SECRET_KEY` | Your Turnstile secret key | Encrypted |
   | `GOOGLE_SCRIPT_URL` | Your Google Apps Script Web App URL | Encrypted |

5. Click **Save**
6. Redeploy the site (or push a new commit) for the variables to take effect

### 5. Recommended Cloudflare Settings

In **Cloudflare Dashboard → your domain:**

- **Security → Bots → Bot Fight Mode:** Turn **ON** (free, blocks known bad bots)
- **Security → WAF:** Consider adding a rate limiting rule:
  - **Rule name:** "Limit order submissions"
  - **When:** URI Path equals `/api/order` AND Method equals `POST`
  - **Rate limit:** 5 requests per 10 minutes per IP
  - **Action:** Block
- **Security → Settings → Challenge Passage:** 30 minutes (default is fine)

---

## How the Cloudflare Function Works

The file `functions/api/order.js` automatically deploys as a serverless function at `/api/order` when using Cloudflare Pages. No additional Worker setup is needed.

**What it does:**
1. Receives the POST request with order data + Turnstile token
2. Verifies the Turnstile token with Cloudflare's API (using the secret key from env vars)
3. Validates required fields (product, quantity, name, email, event type, event date)
4. Checks the honeypot field — if filled, silently accepts (returns 200) but doesn't process
5. Strips sensitive/internal fields (Turnstile token, honeypot) from the payload
6. Adds metadata (timestamp, IP address)
7. Forwards the clean payload to Google Apps Script
8. Returns success/error JSON to the browser

**Environment variables used:**
- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile secret key for server-side verification
- `GOOGLE_SCRIPT_URL` — The deployed Google Apps Script Web App URL

---

## Links

- Website: [bogabeeapiaries.com](https://bogabeeapiaries.com)
- Instagram: [@bogabee_apiaries](https://www.instagram.com/bogabee_apiaries/)
- Google Apps Script (order handler): [Open in editor](https://script.google.com/macros/s/AKfycbykFQA_RDX7TibVlOkZuA2l7l1VgtO04NICAu3aO5FMUZ-nr8tafhe8CA32_N9tUO2L/exec) — must be logged into the bogabeeapiaries@gmail.com Google account to edit
