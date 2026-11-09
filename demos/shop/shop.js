// Shop helpers shared by the cart, checkout, order, porch and owner Orders pages. Load after ../store.js.
(function () {
    const B = window.Bogabee;
    const DAY = 24 * 60 * 60 * 1000;

    const read = (k, fallback) => {
        try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
    };
    const write = (k, v) => {
        localStorage.setItem(k, JSON.stringify(v));
        window.dispatchEvent(new CustomEvent('bogabee:change', { detail: { key: k } }));
    };

    // Jars sold so far come off the harvest's stock.
    const sold = id => B.orders.all().reduce((n, o) => n + (o.items || []).filter(i => i.id === id).reduce((m, i) => m + i.qty, 0), 0);
    const available = id => Math.max(0, B.product(id).stock - sold(id));
    // Show "N left" only when a size is nearly gone.
    const LOW_STOCK = 5;

    // Loose jars in the porch cabinet for walk-up buyers. Pre-orders are bagged separately.
    const cabinet = {
        stock: () => read(B.KEYS.cabinet, null) ?? cabinet.reset(),
        reset() {
            const s = { 'signature-16': 4, 'small-8': 6, 'tasting': 8 };
            localStorage.setItem(B.KEYS.cabinet, JSON.stringify(s));
            return s;
        },
        set(id, n) { write(B.KEYS.cabinet, { ...cabinet.stock(), [id]: Math.max(0, n) }); },
        take(items) {
            const s = cabinet.stock();
            for (const i of items) s[i.id] = Math.max(0, (s[i.id] || 0) - i.qty);
            write(B.KEYS.cabinet, s);
        },
        total: () => Object.values(cabinet.stock()).reduce((a, b) => a + b, 0),
    };

    // Each order gets a one-time code from the lock (igloohome through Seam in production).
    // It works for 24 hours from the pickup time the customer picked and stops after one open.
    const startOfDay = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
    const isoDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const pickupWindow = order => {
        const from = startOfDay(order.pickup.day).getTime() + (order.pickup.hour ?? 7) * 3600e3;
        return { from, to: from + DAY };
    };

    const fmtDay = ts => new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const fmtTime = ts => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const fmtWhen = ts => {
        const d = new Date(ts), now = new Date();
        if (d.toDateString() === now.toDateString()) return 'Today ' + fmtTime(ts);
        if (d.toDateString() === new Date(now.getTime() - DAY).toDateString()) return 'Yesterday ' + fmtTime(ts);
        return fmtDay(ts);
    };
    const fmtWindow = order => {
        const w = pickupWindow(order);
        return `${fmtDay(w.from)}, ${fmtTime(w.from)} – ${fmtDay(w.to)}, ${fmtTime(w.to)}`;
    };
    const splitCode = code => code.slice(0, 3) + ' ' + code.slice(3);

    const itemsText = order => order.items.map(i => `${i.qty}× ${B.product(i.id).name}`).join(', ');

    // Checks a code typed on the cabinet keypad.
    function checkCode(code, now = Date.now()) {
        const order = B.orders.all().find(o => o.pickup && o.pickup.code === code);
        if (!order) return { ok: false, reason: 'That code doesn’t match an order.' };
        if (order.pickup.usedAt) return { ok: false, order, reason: `This code was already used ${fmtWhen(order.pickup.usedAt).replace(/^[A-Z]/, c => c.toLowerCase())}. Each code opens the cabinet once.` };
        if (order.status === 'picked-up') return { ok: false, order, reason: `That order was picked up ${fmtWhen(order.pickup.pickedUpAt).replace(/^[A-Z]/, c => c.toLowerCase())}.` };
        const w = pickupWindow(order);
        if (now < w.from) return { ok: false, order, reason: `This code works from ${fmtDay(w.from)}, ${fmtTime(w.from)}.` };
        if (now > w.to) return { ok: false, order, reason: 'This code has expired. Get a new one on your order page.' };
        return { ok: true, order };
    }
    // The first open uses up the code and counts as the pickup.
    function logOpen(order) {
        const now = Date.now();
        B.orders.update(order.id, {
            status: 'picked-up',
            pickup: { ...order.pickup, opened: [...order.pickup.opened, now], usedAt: now, pickedUpAt: order.pickup.pickedUpAt || now },
        });
    }
    // Where a porch code stands right now: before its window, usable, expired, or used.
    function codeState(order, now = Date.now()) {
        if (order.pickup.usedAt || order.status === 'picked-up') return 'used';
        const w = pickupWindow(order);
        return now < w.from ? 'upcoming' : now > w.to ? 'expired' : 'active';
    }
    // An expired code can be swapped for a fresh one that works from now for 24 hours.
    function reissue(id) {
        const o = B.orders.get(id), now = new Date();
        const code = String(Math.floor(100000 + Math.random() * 900000));
        B.orders.update(id, { pickup: { ...o.pickup, code, day: isoDay(now), hour: now.getHours(), reissued: (o.pickup.reissued || 0) + 1 } });
        return B.orders.get(id);
    }
    function markPickedUp(id) {
        const o = B.orders.get(id);
        B.orders.update(id, { status: 'picked-up', pickup: { ...o.pickup, pickedUpAt: Date.now() } });
    }

    // Local deliveries go out on Saturdays (placeholder schedule until Danny sets it).
    function nextDelivery(ts) {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + (((6 - d.getDay()) + 7) % 7 || 7));
        return d.getTime();
    }

    // The demo's card form checks the same basics Stripe would before it charges anything.
    function cardErrors({ number, exp, cvc }, now = new Date()) {
        const errs = {};
        const digits = String(number).replace(/\D/g, '');
        if (digits.length < 15 || digits.length > 16) errs.number = 'Enter the 15 or 16 digit card number.';
        const m = String(exp).match(/^\s*(\d{1,2})\s*\/\s*(\d{2})\s*$/);
        if (!m || +m[1] < 1 || +m[1] > 12) errs.exp = 'Enter the expiry as MM / YY.';
        else if (new Date(2000 + +m[2], +m[1], 1) <= now) errs.exp = 'This card has expired.';
        if (!/^\d{3,4}$/.test(String(cvc).trim())) errs.cvc = 'Enter the 3 or 4 digit security code.';
        return errs;
    }

    const STATUS = {
        paid: { porch: 'Waiting for pickup', local: 'To deliver', ship: 'To ship' },
        'picked-up': 'Picked up',
        delivered: 'Delivered',
        shipped: 'Shipped',
    };
    const statusLabel = o => (o.status === 'paid' ? STATUS.paid[o.fulfillment] : STATUS[o.status]);
    const isOpen = o => o.status === 'paid';

    // Where "back to the shop" goes: the homepage variant the visitor came from.
    const home = () => sessionStorage.getItem('bogabee-home') || new URL('refined/', document.querySelector('script[src$="store.js"]').src).pathname;

    B.shop = { sold, available, LOW_STOCK, cabinet, pickupWindow, isoDay, fmtDay, fmtTime, fmtWhen, fmtWindow, splitCode, itemsText, checkCode, codeState, reissue, logOpen, markPickedUp, statusLabel, isOpen, home, nextDelivery, cardErrors, DAY };
})();
