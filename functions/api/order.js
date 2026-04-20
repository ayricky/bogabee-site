/**
 * Cloudflare Pages Function — POST /api/order
 *
 * Receives party favor orders from the form, validates the Turnstile token,
 * checks required fields, then forwards to Google Apps Script for
 * storage (Google Sheets) and email notification.
 *
 * Environment variables (set in Cloudflare Dashboard):
 *   TURNSTILE_SECRET_KEY  — Cloudflare Turnstile secret key
 *   GOOGLE_SCRIPT_URL     — Deployed Google Apps Script web app URL
 */

export async function onRequestPost({ request, env }) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const data = await request.json();

    // ── 1. Verify Cloudflare Turnstile ──────────────────────────
    const turnstileRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: data.turnstileToken,
          remoteip: request.headers.get("CF-Connecting-IP"),
        }),
      }
    );
    const turnstileResult = await turnstileRes.json();

    if (!turnstileResult.success) {
      return new Response(
        JSON.stringify({ error: "Security verification failed. Please refresh and try again." }),
        { status: 403, headers }
      );
    }

    // ── 2. Server-side validation ───────────────────────────────
    const required = ["product", "quantity", "name", "email", "event_type", "event_date"];
    const missing = required.filter((f) => !data[f]);
    if (missing.length) {
      return new Response(
        JSON.stringify({ error: `Missing required fields: ${missing.join(", ")}` }),
        { status: 400, headers }
      );
    }

    // Basic email format check
    if (!data.email.includes("@") || !data.email.includes(".")) {
      return new Response(
        JSON.stringify({ error: "Invalid email address" }),
        { status: 400, headers }
      );
    }

    // Quantity must be at least 10
    if (parseInt(data.quantity) < 10) {
      return new Response(
        JSON.stringify({ error: "Minimum order is 10 jars" }),
        { status: 400, headers }
      );
    }

    // ── 3. Honeypot check (bot trap) ────────────────────────────
    if (data._honey) {
      // Bots fill hidden fields — silently accept but don't process
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    // ── 4. Forward to Google Apps Script ─────────────────────────
    // Build clean payload (strip turnstile token and honeypot)
    const orderData = { ...data };
    delete orderData.turnstileToken;
    delete orderData._honey;
    orderData.submittedAt = new Date().toISOString();
    orderData.ip = request.headers.get("CF-Connecting-IP");

    // Google Apps Script returns a 302 redirect. We must handle it manually
    // because fetch changes POST→GET on redirect, so doPost() never fires.
    const scriptRes = await fetch(env.GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderData),
      redirect: "manual",
    });

    // If we get a redirect (302/301), follow it manually with POST
    if (scriptRes.status === 302 || scriptRes.status === 301) {
      const redirectUrl = scriptRes.headers.get("Location");
      if (redirectUrl) {
        const followRes = await fetch(redirectUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderData),
          redirect: "follow",
        });
        const followText = await followRes.text();
        try {
          const result = JSON.parse(followText);
          if (result.error) throw new Error(result.error);
        } catch (parseErr) {
          // Non-JSON response is OK if status is 200
          if (!followRes.ok) throw new Error("Google Apps Script error after redirect");
        }
      }
    } else {
      // No redirect — parse response directly
      const scriptText = await scriptRes.text();
      try {
        const result = JSON.parse(scriptText);
        if (result.error) throw new Error(result.error);
      } catch (parseErr) {
        if (!scriptRes.ok) throw new Error("Google Apps Script returned an error");
      }
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error("Order submission error:", error.message, error.stack);
    return new Response(
      JSON.stringify({
        error: "Something went wrong. Please try again or DM us on Instagram.",
        debug: error.message
      }),
      { status: 500, headers }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
