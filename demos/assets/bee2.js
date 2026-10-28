// The Bogabee bee. One flight engine, ten variations (window.BogabeeBee.VARIANTS).
// Pick one with ?bee=<number or id>; the choice sticks for the session so it follows you
// from page to page. Every variation orbits the pointer and flies off when left alone;
// each adds one behavior on top.
(function () {
    const BROWN = '#563621', GOLD = '#f4d34a', DARK = '#2b1a0f', CREAM = '#fffdf7';

    // ---------- Skins ----------
    let uid = 0;
    function logoSkin() {
        const id = 'b2c' + uid++;
        const wing = side => {
            // The right wing mirrors the left on an outer group, so both rotate about their own root.
            const open = side === 'r' ? '<g transform="matrix(-1 0 0 1 64 0)">' : '<g>';
            return `${open}<g class="b2-wing">
                <path class="b2-membrane" d="M28.6 29.6C21 30 13.4 28.6 12.4 24.6 11.5 21 18.6 21.4 24 24.8 26.4 26.4 27.8 28 28.6 29.6Z"/>
                <path class="b2-membrane" d="M28.5 26.5C19 21.5 9.5 14.5 10 8.5 10.4 3.6 19.6 6.4 25 14.4 27.2 17.8 28.4 22 28.5 26.5Z"/>
                <path class="b2-vein" d="M27.6 24.6C22 18.8 16 13.4 12.6 9.6M27.8 27.8C22.6 25.6 17.6 24.2 13.8 24.4"/>
            </g></g>`;
        };
        const leg = d => `<path d="${d}"/><path d="${d}" transform="matrix(-1 0 0 1 64 0)"/>`;
        return `<svg viewBox="0 0 64 64" aria-hidden="true">
            <defs><clipPath id="${id}"><ellipse cx="32" cy="41.5" rx="8.6" ry="11.2"/></clipPath></defs>
            <g class="b2-legs" fill="none" stroke="${BROWN}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
                ${leg('M27.4 25.6 21.6 23.4 18.6 24.6')}${leg('M27 28.6 21 30.6 18.8 33.8')}${leg('M27.8 31.4 23.4 36.2 22.6 40.6')}
            </g>
            <ellipse cx="32" cy="41.5" rx="8.6" ry="11.2" fill="${GOLD}"/>
            <g clip-path="url(#${id})" fill="${BROWN}"><rect x="20" y="35.8" width="24" height="2.6"/><rect x="20" y="41.6" width="24" height="2.6"/><rect x="20" y="47.6" width="24" height="6"/></g>
            <ellipse cx="32" cy="41.5" rx="8.6" ry="11.2" fill="none" stroke="${BROWN}" stroke-width="1.5"/>
            <path d="M32 52.6v2.8" stroke="${BROWN}" stroke-width="1.6" stroke-linecap="round"/>
            <ellipse cx="32" cy="27.4" rx="6.8" ry="6.2" fill="${BROWN}"/>
            <g fill="#7b5233" opacity=".7"><circle cx="29.4" cy="25.6" r="1.1"/><circle cx="34.6" cy="25.6" r="1.1"/><circle cx="32" cy="29.4" r="1.1"/><circle cx="30" cy="29" r=".8"/><circle cx="34" cy="29" r=".8"/></g>
            <ellipse cx="32" cy="18.6" rx="5.2" ry="4.6" fill="${BROWN}"/>
            <ellipse cx="28.3" cy="18" rx="1.9" ry="2.7" fill="${DARK}"/><ellipse cx="35.7" cy="18" rx="1.9" ry="2.7" fill="${DARK}"/>
            <path d="M30.4 14.6 27.6 10.2 23.8 8.8M33.6 14.6 36.4 10.2 40.2 8.8" fill="none" stroke="${BROWN}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            ${wing('l')}${wing('r')}
        </svg>`;
    }
    // A rounder, fuzzier bumblebee: a fur fringe drawn as a dotted outline, small wings.
    function bumbleSkin() {
        const id = 'b2c' + uid++;
        const wing = side => {
            const open = side === 'r' ? '<g transform="matrix(-1 0 0 1 64 0)">' : '<g>';
            return `${open}<g class="b2-wing" style="transform-origin: 26px 27px">
                <path class="b2-membrane" d="M26 27C19 25 13 20 13.6 15.6 14.2 11.6 20.4 13.4 23.6 18.6 25 21 25.8 24 26 27Z"/>
                <path class="b2-membrane" d="M26.4 30C21 31 16.4 30.4 15.8 28 15.2 25.6 19.8 25.4 23.2 27 24.8 27.8 25.8 28.8 26.4 30Z"/>
            </g></g>`;
        };
        const leg = d => `<path d="${d}"/><path d="${d}" transform="matrix(-1 0 0 1 64 0)"/>`;
        return `<svg viewBox="0 0 64 64" aria-hidden="true">
            <defs><clipPath id="${id}"><ellipse cx="32" cy="40" rx="12" ry="13.4"/></clipPath></defs>
            <g class="b2-legs" fill="none" stroke="${BROWN}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                ${leg('M24.6 26 19 24 16.4 25.6')}${leg('M24.4 30 18.6 32.2 17 35.6')}${leg('M25.6 34 21.4 38.8 21 43')}
            </g>
            <ellipse cx="32" cy="40" rx="12" ry="13.4" fill="${GOLD}"/>
            <g clip-path="url(#${id})" fill="${BROWN}"><rect x="16" y="36.4" width="32" height="4.4"/><rect x="16" y="45.6" width="32" height="12"/></g>
            <ellipse cx="32" cy="40" rx="12" ry="13.4" fill="none" stroke="${BROWN}" stroke-width="2.4" stroke-dasharray=".1 2.2" stroke-linecap="round"/>
            <ellipse cx="32" cy="40" rx="12" ry="13.4" fill="none" stroke="${BROWN}" stroke-width="1"/>
            <ellipse cx="32" cy="26.4" rx="9" ry="8" fill="${BROWN}"/>
            <ellipse cx="32" cy="26.4" rx="9" ry="8" fill="none" stroke="${BROWN}" stroke-width="2.6" stroke-dasharray=".1 2.1" stroke-linecap="round"/>
            <ellipse cx="32" cy="25" rx="5.4" ry="3.6" fill="${GOLD}" opacity=".85"/>
            <ellipse cx="32" cy="16.4" rx="5.4" ry="4.4" fill="${BROWN}"/>
            <ellipse cx="28.2" cy="16" rx="1.9" ry="2.4" fill="${DARK}"/><ellipse cx="35.8" cy="16" rx="1.9" ry="2.4" fill="${DARK}"/>
            <path d="M30.2 12.6 28.4 8.6 25.2 7.6M33.8 12.6 35.6 8.6 38.8 7.6" fill="none" stroke="${BROWN}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            ${wing('l')}${wing('r')}
        </svg>`;
    }
    const JAR = `<svg viewBox="0 0 16 18" aria-hidden="true"><rect x="4" y="1" width="8" height="3" rx="1" fill="#c9a24a"/><path d="M3 4.5h10a1 1 0 0 1 1 1V15a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5.5a1 1 0 0 1 1-1Z" fill="#e0a526"/><rect x="5" y="8" width="6" height="5" rx="2.5" fill="${CREAM}"/></svg>`;

    // ---------- Variations ----------
    const VARIANTS = [
        { id: 'bogabee', name: 'Bogabee', pick: true, does: 'Keeps its distance from fast moves, carries every jar you add into the cart, and dozes off when you stop.', tip: 'Add a jar, then hold still.', o: { shy: true, courier: true, sleepy: true, leave: false } },
        { id: 'classic', name: 'Classic', does: 'Circles the pointer, darts across now and then, and lands beside it when you stop.', tip: 'Stop moving for a second.', o: {} },
        { id: 'pollinator', name: 'Pollinator', does: 'Rest on a button, photo or jar and the bee lands on it and dusts it with pollen.', tip: 'Hold the pointer still on a button.', o: { pollinate: true } },
        { id: 'courier', name: 'Courier', does: 'Add a jar and the bee picks up a tiny jar and carries it into the cart.', tip: 'Press Add to cart.', o: { courier: true } },
        { id: 'waggle', name: 'Waggle dance', does: "Leave it alone and it does a honey bee's waggle dance, pointing the way to the jars.", tip: 'Stop moving for two seconds.', o: { waggle: true, land: false } },
        { id: 'shy', name: 'Shy', does: 'Keeps its distance and scoots away from fast moves, then creeps closer when you hold still.', tip: 'Swipe quickly toward it.', o: { shy: true } },
        { id: 'sleepy', name: 'Sleepy', does: 'Lands, then nods off. Move again and it wakes with a start.', tip: 'Leave the pointer still for a few seconds.', o: { sleepy: true, leave: false } },
        { id: 'breeze', name: 'Breeze', does: 'Scrolling blows it around like a gust, then it fights its way back.', tip: 'Scroll fast.', o: { breeze: true } },
        { id: 'boop', name: 'Boop', does: 'Tap or click the bee and it does a loop. Click anywhere and it zips over.', tip: 'Click right on the bee.', o: { boop: true } },
        { id: 'pair', name: 'Pair', does: 'Two bees: one follows you, the other chases it, and they land side by side.', tip: 'Move in circles.', o: { pair: true } },
        { id: 'bumble', name: 'Bumblebee', does: 'A rounder, fuzzier bee that flies slow and a little clumsy.', tip: 'Make it turn sharply.', o: { skin: 'bumble', heavy: true } },
    ];

    const CSS = `
    .b2, .b2-shadow, .b2-fx { position: fixed; inset: 0 auto auto 0; margin: 0; padding: 0; border: 0; background: none; overflow: visible; pointer-events: none; color: inherit; }
    .b2 { z-index: 9999; width: 46px; height: 46px; translate: -23px -23px; will-change: transform; contain: layout style; }
    .b2.bumble { width: 54px; height: 54px; translate: -27px -27px; }
    .b2::backdrop, .b2-shadow::backdrop, .b2-fx::backdrop { display: none; }
    .b2-roll { position: relative; z-index: 1; width: 100%; height: 100%; transition: scale .35s cubic-bezier(.16,1,.3,1); }
    .b2 svg { display: block; width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 1px .5px rgb(43 26 15 / .35)); }
    .b2-membrane { fill: rgb(255 253 247 / .62); stroke: ${BROWN}; stroke-width: .9; stroke-linejoin: round; }
    .b2-vein { fill: none; stroke: ${BROWN}; stroke-width: .55; stroke-linecap: round; opacity: .55; }
    .b2-wing { transform-box: view-box; transform-origin: 28.5px 27px; transition: rotate .3s cubic-bezier(.16,1,.3,1); }
    .b2-legs { opacity: 0; transition: opacity .3s; }
    .b2.flying .b2-wing { animation: b2-flap 46ms linear infinite alternate; }
    .b2.bumble.flying .b2-wing { animation-duration: 38ms; }
    @keyframes b2-flap { from { rotate: -26deg; opacity: .55; } to { rotate: 14deg; opacity: .9; } }
    .b2.landed .b2-wing { rotate: -112deg; }
    .b2.bumble.landed .b2-wing { rotate: -70deg; }
    .b2.landed .b2-legs { opacity: 1; }
    .b2.landed .b2-roll { scale: .94; }
    .b2.asleep .b2-roll { animation: b2-breathe 2.4s ease-in-out infinite; }
    @keyframes b2-breathe { 50% { scale: .9; } }
    .b2-cargo { position: absolute; left: 50%; top: 50%; width: 22px; height: 25px; translate: -50% 2px; animation: b2-pop .4s cubic-bezier(.3,1.6,.5,1); }
    .b2-cargo svg, .b2-drop svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 2px 2px rgb(43 26 15 / .3)); }
    @keyframes b2-pop { from { scale: 0; } }
    .b2-drop { position: absolute; width: 22px; height: 25px; translate: -50% -50%; animation: b2-drop .45s ease-in forwards; }
    @keyframes b2-drop { to { translate: -50% 18px; scale: .55; opacity: 0; } }
    .b2-trail { position: absolute; width: 5px; height: 5px; border-radius: 50%; translate: -50% -50%; background: ${GOLD}; box-shadow: 0 0 0 1px rgb(224 165 38 / .55); animation: b2-trail 1.5s ease-out forwards; }
    @keyframes b2-trail { to { opacity: 0; scale: .3; } }
    .b2-shadow { z-index: 9998; width: 30px; height: 16px; translate: -15px -8px; border-radius: 50%; background: radial-gradient(closest-side, rgb(36 24 14 / .22), transparent); will-change: transform, opacity; }
    .b2-fx { z-index: 9999; width: 0; height: 0; }
    .b2-pollen { position: absolute; width: 5px; height: 5px; border-radius: 50%; background: ${GOLD}; box-shadow: 0 0 0 1px rgb(224 165 38 / .6); animation: b2-pollen 1.6s ease-out forwards; }
    @keyframes b2-pollen { to { translate: var(--dx) 18px; opacity: 0; scale: .4; } }
    .b2-z { position: absolute; font: italic 500 15px/1 Fraunces, Georgia, serif; color: ${BROWN}; animation: b2-z 2.2s ease-out forwards; }
    @keyframes b2-z { from { opacity: 0; translate: 0 0; scale: .6; } 20% { opacity: 1; } to { opacity: 0; translate: 16px -34px; scale: 1.2; } }
    .b2-bump { animation: b2-bump .5s cubic-bezier(.3,1.6,.5,1); }
    @keyframes b2-bump { 40% { scale: 1.15; } }
    .b2-toggle { display: block; margin: 16px auto 0; padding: 8px 12px; border: 0; background: none; color: inherit; font: inherit; font-size: 13px; opacity: .72; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .b2-toggle:hover { opacity: 1; }
    .b2.staged, .b2-shadow.staged, .b2-fx.staged { position: absolute; z-index: 3; }
    .b2-shadow.staged { z-index: 2; }
    @media (prefers-reduced-motion: reduce) { .b2.flying .b2-wing { animation: none; opacity: .75; } .b2.asleep .b2-roll { animation: none; } }`;

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canPop = typeof HTMLElement.prototype.showPopover === 'function';
    const W = () => innerWidth, H = () => innerHeight;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    // Shared pointer and page state, fed by one set of listeners.
    const P = { x: W() / 2, y: H() / 2, last: performance.now(), speed: 0, vx: 0, vy: 0, hovered: null, touch: false };
    let active = null;

    // An environment is where a bee lives: the whole window on the site, or one box (a stage)
    // in the Bee lab. Positions, lookups and rectangles are all relative to it.
    const WINDOW = { P, W, H, root: document, rect: el => el.getBoundingClientRect(), layer: null, staged: false };

    function makeEl(cls, html, E) {
        const el = document.createElement('div');
        el.className = cls + (E.staged ? ' staged' : '');
        if (html) el.innerHTML = html;
        el.setAttribute('aria-hidden', 'true');
        if (E.staged) { E.layer.appendChild(el); return el; }
        if (canPop) el.popover = 'manual';
        document.body.appendChild(el);
        if (canPop) el.showPopover();
        return el;
    }
    // Keep the bee above modal dialogs (the cart drawer) by re-entering the top layer after them.
    function raise(els) {
        if (!canPop) return;
        els.forEach(el => { if (el.isConnected) { el.hidePopover(); el.showPopover(); } });
    }

    function createBee(skin, E) {
        const shadow = makeEl('b2-shadow', '', E);
        const el = makeEl('b2 flying' + (skin === 'bumble' ? ' bumble' : ''), `<div class="b2-roll">${skin === 'bumble' ? bumbleSkin() : logoSkin()}</div>`, E);
        return {
            el, shadow, roll: el.firstElementChild,
            x: E.P.x + (Math.random() - .5) * 120, y: E.P.y + 60, vx: 0, vy: 0,
            angle: 0, bank: 0, lift: 1, spin: 0, landed: false, landedAt: 0, seed: Math.random() * 100, cargo: null,
        };
    }

    // ---------- Where a bee may land ----------
    // Never on what someone is using or reading: not on text, controls or the focused field,
    // and not under the fixed nav. On touch screens it prefers the screen edge.
    const BUSY = 'p, h1, h2, h3, h4, li, blockquote, figcaption, label, input, textarea, select, button, a, .btn, [contenteditable], summary, dt, dd, td, th, small, time, output';
    const NAV_H = 84;
    function focusedRect() {
        const f = document.activeElement;
        if (!f || f === document.body || !f.matches || !f.matches('input, textarea, select, button, a, [contenteditable], [tabindex]')) return null;
        return f.getBoundingClientRect();
    }
    function clearAt(x, y) {
        if (x < 26 || x > innerWidth - 26 || y < NAV_H + 20 || y > innerHeight - 26) return false;
        const f = focusedRect();
        if (f && x > f.left - 40 && x < f.right + 40 && y > f.top - 40 && y < f.bottom + 40) return false;
        for (const [dx, dy] of [[0, 0], [-18, -14], [18, -14], [-18, 14], [18, 14]]) {
            const el = document.elementFromPoint(x + dx, y + dy);
            if (el && el.closest(BUSY)) return false;
        }
        return true;
    }
    function spotNear(x, y, side, near) {
        const edgeX = x < innerWidth / 2 ? 30 : innerWidth - 30, farX = innerWidth - edgeX;
        const edges = [0, -70, 70, -140, 140, -220, 220].flatMap(dy => [[edgeX, y + dy], [farX, y + dy]]);
        const beside = [[x + side * near, y + 16], [x - side * near, y + 16], [x + side * (near + 50), y], [x, y - 64], [x, y + 72],
            [x + side * near, y - 56], [x - side * near, y - 56], [x + side * (near + 110), y + 20], [x - side * (near + 110), y + 20]];
        const tries = P.touch ? edges : [...beside, ...edges];
        for (const [cx, cy] of tries) if (clearAt(cx, cy)) return { x: cx, y: cy };
        return { x: edgeX, y: clamp(y, NAV_H + 40, innerHeight - 40) };
    }

    function start(which) {
        const v = VARIANTS.find((x, i) => x.id === which || String(i + 1) === String(which)) || VARIANTS[0];
        if (active) active.destroy();
        active = run(v, WINDOW);
        try { sessionStorage.setItem('bogabee-bee', v.id); } catch (e) {}
        window.dispatchEvent(new CustomEvent('bogabee:bee', { detail: v }));
        return v;
    }

    function run(variant, E) {
        const P = E.P, W = E.W, H = E.H;
        // A stage loops one scene, so its bee never wanders off.
        const o = Object.assign({ land: true, leave: !E.staged, dart: true, skin: 'logo' }, variant.o, E.staged ? { leave: false } : {});
        const heavy = !!o.heavy;
        // With reduced motion the bee sits still in a free spot and ignores everything else.
        const still = reduce && !E.staged;
        let rest = still ? spotNear(innerWidth - 64, innerHeight - 120, -1, 30) : null;
        if (still) addEventListener('resize', () => { rest = spotNear(innerWidth - 64, innerHeight - 120, -1, 30); });
        const bees = [createBee(o.skin, E)];
        if (o.pair) bees.push(createBee(o.skin, E));
        if (still) bees.forEach((b, i) => { b.x = rest.x - i * 34; b.y = rest.y; b.lift = 0; b.angle = (-Math.PI / 2 - .3) * 180 / Math.PI + 90; });
        const fx = makeEl('b2-fx', '', E);
        const lead = bees[0];
        let alive = true, paused = false, raf = 0;
        let mode = 'follow', modeAt = performance.now();
        let landX = 0, landY = 0, leaveX = 0, leaveY = 0, dartX = 0, dartY = 0, dartUntil = 0, nextDart = performance.now() + 5000;
        let waggleX = 0, waggleY = 0, loop = null, carry = null, perch = null, lastPollen = 0, lastZ = 0, lastClear = 0;
        const queue = [];
        const mid = el => { const r = E.rect(el); return { x: r.left + r.width / 2, y: r.top + r.height * .45, el }; };
        // Visible means inside the view and not under the open cart panel.
        const onScreen = el => {
            const r = E.rect(el);
            if (!(r.width > 0 && r.bottom > 0 && r.top < H() && r.right > 0 && r.left < W())) return false;
            const panel = E.root.querySelector('.cart-drawer[open] .cart-panel');
            if (!panel || panel.contains(el)) return true;
            const p = E.rect(panel), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            return !(cx > p.left && cx < p.right && cy > p.top && cy < p.bottom);
        };
        // The jar's photo on the page, its line in the open cart, and the cart button.
        const shotOf = t => {
            const card = (t.btn && t.btn.isConnected && t.btn.closest('.product, .mini-card')) ||
                (t.id && (E.root.querySelector(`.product [data-add="${t.id}"]`) || {}).closest?.('.product'));
            const img = card && card.querySelector('.shot img, img');
            return img && onScreen(img) ? img : null;
        };
        const lineOf = t => {
            const b = t.id && E.root.querySelector(`.cart-drawer[open] [data-step="1"][data-id="${t.id}"]`);
            return b ? b.closest('.cart-line').querySelector('img') : null;
        };
        function begin(t) {
            if (lead.cargo) { lead.cargo.remove(); lead.cargo = null; }
            const into = t.dir > 0;
            const fast = queue.length > 0 || t.fast;
            carry = {
                ...t, fast, phase: 'pickup',
                // Into the cart: from the jar's photo (or where you tapped) to its line.
                // Out of the cart: from its line (where it was when tapped) back to the photo, or beside the cart.
                from: into ? () => { const s = shotOf(t); return s ? mid(s) : t.at; } : () => t.at,
                to: into
                    ? () => { const l = lineOf(t) || E.root.querySelector('[data-cart-open]'); return l ? mid(l) : null; }
                    : () => { const s = shotOf(t); return s ? mid(s) : { x: t.at.x - 170, y: t.at.y + 50 }; },
            };
            setMode('carry');
        }
        const setMode = m => { mode = m; modeAt = performance.now(); };

        function burst(cls, x, y, extra) {
            const s = document.createElement('span');
            s.className = cls;
            s.style.left = x + 'px'; s.style.top = y + 'px';
            if (extra) extra(s);
            fx.appendChild(s);
            s.addEventListener('animationend', () => s.remove());
        }

        // ---------- Inputs routed to this variation ----------
        const on = {
            move() {
                if (still) return;
                if (mode === 'away' || mode === 'leaving') {
                    // Come back in from the nearest edge.
                    const edges = [[-40, P.y], [W() + 40, P.y], [P.x, -40], [P.x, H() + 40]];
                    const d = edges.map(([ex, ey]) => Math.hypot(ex - P.x, ey - P.y));
                    const [ex, ey] = edges[d.indexOf(Math.min(...d))];
                    bees.forEach((b, i) => { b.x = ex + i * 20; b.y = ey; b.vx = b.vy = 0; });
                    setMode('follow');
                } else if (mode === 'sleep') {
                    // Startled awake: a hop and a burst of speed.
                    bees.forEach(b => { b.vy -= 7; b.vx += (Math.random() - .5) * 6; b.spin += 40; });
                    setMode('follow');
                } else if (['land', 'perch', 'waggle'].includes(mode)) setMode('follow');
                if (o.shy && P.speed > 1.4) {
                    bees.forEach(b => {
                        const dx = b.x - P.x, dy = b.y - P.y, d = Math.hypot(dx, dy) || 1;
                        const toward = (P.vx * -dx + P.vy * -dy) / d;
                        if (d < 190 && toward > 0.6) { b.vx += dx / d * 9; b.vy += dy / d * 9; }
                    });
                }
            },
            down(e) {
                if (still || !o.boop) return;
                const d = Math.hypot(e.clientX - lead.x, e.clientY - lead.y);
                if (d < 46) {
                    loop = { t0: performance.now(), cx: lead.x, cy: lead.y - 34, dir: Math.random() < .5 ? 1 : -1 };
                    setMode('loop');
                } else if (mode !== 'loop') {
                    dartX = e.clientX + 24; dartY = e.clientY + 10; dartUntil = performance.now() + 650; setMode('dart');
                }
            },
            scroll(dy) {
                if (still || !o.breeze) return;
                bees.forEach(b => { b.vy -= clamp(dy * .45, -26, 26); b.vx += (Math.random() - .5) * Math.abs(dy) * .15; b.spin += clamp(dy, -60, 60) * 2; });
                if (['land', 'perch', 'sleep'].includes(mode)) setMode('follow');
            },
            // A jar going into (+1) or out of (-1) the cart. Quick taps queue up as back-to-back trips.
            trip(t) {
                if (still || !o.courier) return;
                if (mode !== 'carry') { begin(t); return; }
                if (queue.length < 3) queue.push(t);
            },
            dialog() { if (!E.staged) raise([...bees.flatMap(b => [b.shadow, b.el]), fx]); },
        };

        function orbit(b, t) {
            const r = (o.shy ? 150 : 70) + Math.sin(t * .21 + b.seed) * 22;
            return {
                tx: P.x + (Math.sin(t * .62 + b.seed) * .72 + Math.sin(t * .27 + b.seed * 2) * .48) * r,
                ty: P.y + (Math.sin(t * .47 + b.seed * 3) * .62 + Math.cos(t * .16 + b.seed) * .42) * r,
                k: heavy ? .0028 : .0042, damp: heavy ? .935 : .92, max: heavy ? 7 : 11,
            };
        }

        // Where this bee wants to be this frame, and how it gets there.
        function intent(b, now, t) {
            if (still) return { tx: rest.x - bees.indexOf(b) * 34, ty: rest.y, k: 1, damp: 0, max: 1e4, land: true, face: -Math.PI / 2 - .3 };
            const idle = now - P.last;
            if (b === lead) {
                if (mode === 'follow' && idle > (o.waggle ? 2000 : 1300)) {
                    if (o.waggle) { waggleX = lead.x; waggleY = lead.y; setMode('waggle'); }
                    else if (o.pollinate && P.hovered && P.hovered.isConnected) { perch = P.hovered; setMode('perch'); }
                    else if (o.land) {
                        const side = lead.x < P.x ? -1 : 1, near = o.shy ? 64 : 30;
                        if (E.staged) { landX = P.x + side * near; landY = P.y + 16; }
                        else ({ x: landX, y: landY } = spotNear(P.x, P.y, side, near));
                        setMode('land');
                    }
                }
                if (o.leave && idle > 14000 && !['leaving', 'away', 'carry', 'loop', 'sleep'].includes(mode)) {
                    const a = Math.random() * Math.PI * 2, r = Math.max(W(), H());
                    leaveX = lead.x + Math.cos(a) * r; leaveY = lead.y + Math.sin(a) * r; setMode('leaving');
                }
                if (!E.staged && (mode === 'land' || mode === 'sleep') && now - lastClear > 500) {
                    lastClear = now;
                    if (!clearAt(landX, landY)) { ({ x: landX, y: landY } = spotNear(landX, landY, landX < P.x ? -1 : 1, 40)); setMode('land'); }
                }
                if (o.sleepy && (mode === 'land' || mode === 'perch') && lead.landed && now - lead.landedAt > 3500) setMode('sleep');
                if (mode === 'leaving' && bees.every(x => x.x < -60 || x.x > W() + 60 || x.y < -60 || x.y > H() + 60)) setMode('away');
                if (o.dart && mode === 'follow' && now > nextDart && idle < 400 && Math.random() < .02) {
                    dartX = P.x * 2 - lead.x + (Math.random() - .5) * 90; dartY = P.y * 2 - lead.y + (Math.random() - .5) * 90;
                    dartUntil = now + 700; nextDart = now + 5000 + Math.random() * 6000; setMode('dart');
                }
                if (mode === 'dart' && now > dartUntil) setMode('follow');
            } else {
                // The second bee of a pair circles the first and lands beside it.
                if (mode === 'away') return null;
                if (lead.landed || mode === 'sleep') return { tx: lead.x + 30, ty: lead.y + 4, k: .02, damp: .8, max: 6, land: true, sleep: mode === 'sleep' };
                const a = t * 2.1 + b.seed;
                return { tx: lead.x + Math.cos(a) * 44, ty: lead.y + Math.sin(a) * 30, k: .012, damp: .88, max: 13 };
            }

            switch (mode) {
                case 'away': return null;
                case 'land': return { tx: landX, ty: landY, k: o.shy ? .008 : .02, damp: .8, max: o.shy ? 3 : 6, land: true };
                case 'sleep': return { tx: lead.x, ty: lead.y, k: 0, damp: .5, max: 1, land: true, sleep: true };
                case 'leaving': return { tx: leaveX, ty: leaveY, k: .0016, damp: .97, max: 7 };
                case 'dart': return { tx: dartX, ty: dartY, k: .02, damp: .86, max: 16 };
                case 'perch': {
                    if (!perch.isConnected) { setMode('follow'); break; }
                    const r = E.rect(perch);
                    return { tx: r.right - 14, ty: r.top + 6, k: .018, damp: .8, max: 9, land: true, pollen: true };
                }
                case 'waggle': {
                    // A straight waggle run toward the jars, then a half loop back, alternating sides.
                    const goal = E.root.querySelector('[data-bee-goal], #order, [data-cart-open], .btn');
                    let dir = -Math.PI / 2;
                    if (goal) { const r = E.rect(goal); dir = Math.atan2(r.top + r.height / 2 - waggleY, r.left + r.width / 2 - waggleX); }
                    const RUN = 900, LOOP = 1300, LEN = 64, el = now - modeAt;
                    const cyc = el % ((RUN + LOOP) * 2), side = cyc < RUN + LOOP ? 1 : -1, local = cyc % (RUN + LOOP);
                    const ux = Math.cos(dir), uy = Math.sin(dir);
                    if (local < RUN) {
                        const p = local / RUN, shake = reduce ? 0 : Math.sin(p * Math.PI * 26) * 5;
                        return { tx: waggleX + ux * LEN * p - uy * shake, ty: waggleY + uy * LEN * p + ux * shake, k: .5, damp: .3, max: 40, face: dir };
                    }
                    const th = Math.PI * (local - RUN) / LOOP;
                    const cx = waggleX + ux * LEN / 2, cy = waggleY + uy * LEN / 2;
                    const al = Math.cos(th) * LEN / 2, ac = Math.sin(th) * LEN / 2 * side;
                    return { tx: cx + ux * al - uy * ac, ty: cy + uy * al + ux * ac, k: .2, damp: .5, max: 20 };
                }
                case 'loop': {
                    const p = (now - loop.t0) / 800;
                    if (p >= 1) { setMode('follow'); break; }
                    const a = Math.PI / 2 + loop.dir * p * Math.PI * 2;
                    return { tx: loop.cx + Math.cos(a) * 34, ty: loop.cy + Math.sin(a) * 34, k: .5, damp: .35, max: 30 };
                }
                case 'carry': {
                    // 1. Fly to the jar.  2. Lift it.  3. Carry it on an arc, leaving a trail.
                    // 4. Hover over where it goes, let go, and land beside it (or start the next trip).
                    const c = carry, speed = c.fast ? .6 : 1;
                    if (c.phase === 'pickup') {
                        const f = c.from();
                        if (!f) { setMode('follow'); break; }
                        const tx = f.x, ty = f.y - 6;
                        if (Math.hypot(tx - lead.x, ty - lead.y) < 10) {
                            Object.assign(c, { phase: 'lift', t0: now, x: tx, y: ty });
                            lead.cargo = document.createElement('span');
                            lead.cargo.className = 'b2-cargo';
                            lead.cargo.innerHTML = JAR;
                            lead.el.appendChild(lead.cargo);
                            if (f.el && c.dir < 0) { f.el.classList.remove('b2-bump'); void f.el.offsetWidth; f.el.classList.add('b2-bump'); }
                        }
                        return { tx, ty, k: .02, damp: .8, max: c.fast ? 12 : 8 };
                    }
                    if (c.phase === 'lift') {
                        const p = Math.min(1, (now - c.t0) / (700 * speed));
                        if (p >= 1) Object.assign(c, { phase: 'fly', t0: now, start: { x: lead.x, y: lead.y } });
                        return { tx: c.x, ty: c.y - 28 * p, k: .2, damp: .6, max: 3 };
                    }
                    const d = c.to();
                    if (!d) { if (lead.cargo) { lead.cargo.remove(); lead.cargo = null; } setMode('follow'); break; }
                    const dx = d.x, dy = d.y - 20;
                    if (c.phase === 'fly') {
                        const f = c.start, dist = Math.hypot(dx - f.x, dy - f.y);
                        const p = Math.min(1, (now - c.t0) / (clamp(dist * 4, 1800, 3200) * speed));
                        const e = p < .5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2, u = 1 - e;
                        const cx = (f.x + dx) / 2, cy = Math.min(f.y, dy) - clamp(dist * .35, 60, 180);
                        if (now - (c.trail || 0) > 70) { c.trail = now; burst('b2-trail', lead.x, lead.y + 10); }
                        if (p >= 1) Object.assign(c, { phase: 'drop', t0: now });
                        return { tx: u * u * f.x + 2 * u * e * cx + e * e * dx, ty: u * u * f.y + 2 * u * e * cy + e * e * dy, k: .3, damp: .55, max: 30 };
                    }
                    if (lead.cargo && now - c.t0 > 450 * speed) {
                        lead.cargo.remove(); lead.cargo = null;
                        burst('b2-drop', lead.x, lead.y + 12, s => { s.innerHTML = JAR; });
                        setTimeout(() => {
                            if (d.el) { d.el.classList.remove('b2-bump'); void d.el.offsetWidth; d.el.classList.add('b2-bump'); }
                            for (let i = 0; i < 7; i++) burst('b2-pollen', dx + (Math.random() - .5) * 24, dy + 20 + (Math.random() - .5) * 16, s => s.style.setProperty('--dx', (Math.random() - .5) * 30 + 'px'));
                        }, 380);
                        c.dropped = now;
                    }
                    if (c.dropped && now - c.dropped > 700 * speed) {
                        if (queue.length) { begin({ ...queue.shift(), fast: true }); break; }
                        const side = dx > W() / 2 ? -1 : 1;
                        if (E.staged) { landX = dx + side * 30; landY = dy + 34; }
                        else ({ x: landX, y: landY } = spotNear(dx, dy + 20, side, 34));
                        setMode('land');
                    }
                    return { tx: dx, ty: dy, k: .05, damp: .7, max: 3 };
                }
            }
            return orbit(b, t);
        }

        function step(now) {
            if (!alive) return;
            if (paused) { raf = 0; return; }
            const t = now / 1000;
            for (const b of bees) {
                const it = intent(b, now, t);
                b.el.style.opacity = b.shadow.style.opacity = it ? '' : 0;
                if (!it) continue;
                b.vx = (b.vx + (it.tx - b.x) * it.k) * it.damp;
                b.vy = (b.vy + (it.ty - b.y) * it.k) * it.damp;
                // Gusts may push a bee past its own top speed; nothing else may.
                const sp = Math.hypot(b.vx, b.vy), cap = o.breeze ? it.max * 3 : it.max;
                if (sp > cap) { b.vx *= cap / sp; b.vy *= cap / sp; }
                b.x += b.vx; b.y += b.vy;

                const landed = !!it.land && Math.hypot(it.tx - b.x, it.ty - b.y) < 3;
                if (landed && !b.landed) b.landedAt = now;
                b.landed = landed;
                b.el.classList.toggle('landed', landed);
                b.el.classList.toggle('flying', !landed);
                b.el.classList.toggle('asleep', !!it.sleep && landed);

                // Face the way it's flying when fast; face the pointer when hovering or landed.
                let target = b.angle;
                if (it.face !== undefined) target = it.face * 180 / Math.PI + 90;
                else if (landed || (mode === 'follow' && sp < 2.2)) target = Math.atan2(P.y - b.y, P.x - b.x) * 180 / Math.PI + 90;
                else if (sp > .6) target = Math.atan2(b.vy, b.vx) * 180 / Math.PI + 90;
                let diff = target - b.angle;
                diff -= Math.round(diff / 360) * 360;
                b.angle += diff * (heavy ? .07 : landed ? .12 : .1);
                b.spin *= .9;
                // Lean into turns: the rate of turn becomes a roll, drawn as a narrowing of the body.
                b.bank += (clamp(diff / 40, -1, 1) - b.bank) * .15;
                b.lift += ((landed ? 0 : 1) - b.lift) * .08;

                // Heavier bees bob more and wobble when they turn hard.
                const bob = reduce || landed ? 0 : Math.sin(t * (heavy ? 6 : 9) + b.seed) * (heavy ? 2.6 : 1.4) * b.lift;
                const wob = heavy && !reduce ? Math.sin(t * 13 + b.seed) * Math.abs(b.bank) * 9 : 0;
                b.roll.style.transform = `scaleX(${1 - Math.abs(b.bank) * .22})`;
                b.el.style.transform = `translate3d(${b.x}px, ${b.y + bob}px, 0) rotate(${b.angle + b.spin + wob}deg)`;
                // The shadow falls down-right and tightens as the bee comes down.
                const off = 4 + 14 * b.lift;
                b.shadow.style.transform = `translate3d(${b.x + off * .6}px, ${b.y + off}px, 0) rotate(${b.angle}deg) scale(${1 + b.lift * .25})`;
                b.shadow.style.opacity = .55 + (1 - b.lift) * .45;

                if (b === lead && it.pollen && landed && now - lastPollen > 320) {
                    lastPollen = now;
                    burst('b2-pollen', b.x + (Math.random() - .5) * 26, b.y + (Math.random() - .2) * 18, s => s.style.setProperty('--dx', (Math.random() - .5) * 24 + 'px'));
                }
                if (b === lead && it.sleep && landed && now - lastZ > 900) {
                    lastZ = now;
                    burst('b2-z', b.x + 12, b.y - 18, s => { s.textContent = 'z'; });
                }
            }
            raf = requestAnimationFrame(step);
        }
        raf = requestAnimationFrame(step);

        return {
            variant, on,
            pause(v) { paused = v; if (!v && !raf) raf = requestAnimationFrame(step); },
            get pos() { return { x: lead.x, y: lead.y }; },
            destroy() {
                alive = false;
                cancelAnimationFrame(raf);
                bees.forEach(b => { b.el.remove(); b.shadow.remove(); });
                fx.remove();
            },
        };
    }

    // ---------- Global listeners, routed to the running variation ----------
    let lastT = performance.now(), lastScroll = scrollY;
    function pointer(e) {
        const now = performance.now(), dt = Math.max(1, now - lastT);
        P.vx = (e.clientX - P.x) / dt; P.vy = (e.clientY - P.y) / dt;
        P.speed = Math.hypot(P.vx, P.vy);
        P.x = e.clientX; P.y = e.clientY; P.last = now; lastT = now;
        P.touch = e.pointerType === 'touch';
        if (active) active.on.move();
    }
    addEventListener('pointermove', pointer, { passive: true });
    addEventListener('pointerdown', e => { pointer(e); if (active) active.on.down(e); }, { passive: true });
    addEventListener('pointerover', e => { P.hovered = e.target.closest ? e.target.closest('button, a.btn, .product, .photo, [data-bee-perch]') : null; }, { passive: true });
    addEventListener('scroll', () => { const d = scrollY - lastScroll; lastScroll = scrollY; if (active) active.on.scroll(d); }, { passive: true });
    // Capture phase, so the tapped control is still in place before the cart redraws.
    document.addEventListener('click', e => {
        if (!active || !e.target.closest) return;
        const add = e.target.closest('[data-add]');
        if (add) { const r = add.getBoundingClientRect(); active.on.trip({ dir: 1, id: add.dataset.add, btn: add, at: { x: r.left + r.width / 2, y: r.top } }); return; }
        const stepBtn = e.target.closest('.cart-drawer [data-step]');
        const remove = e.target.closest('.cart-drawer [data-remove]');
        const ctl = stepBtn || remove;
        if (!ctl || ctl.disabled) return;
        const line = ctl.closest('.cart-line'), img = line && line.querySelector('img');
        const r = (img || ctl).getBoundingClientRect(), b = ctl.getBoundingClientRect();
        const dir = stepBtn ? Number(stepBtn.dataset.step) : -1;
        const id = stepBtn ? stepBtn.dataset.id : remove.dataset.remove;
        // Adding pulls a jar from its photo, or from the + if the photo is hidden; taking out starts at the line.
        active.on.trip({ dir, id, at: dir > 0 ? { x: b.left + b.width / 2, y: b.top } : { x: r.left + r.width / 2, y: r.top + r.height * .45 } });
    }, true);
    new MutationObserver(muts => {
        if (active && muts.some(m => m.target.tagName === 'DIALOG' && m.target.open)) setTimeout(() => active && active.on.dialog(), 0);
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'] });

    // A self-contained bee in a box, driven by a script instead of the real pointer.
    function stage(box, which) {
        const v = VARIANTS.find(x => x.id === which) || VARIANTS[0];
        const E = {
            P: { x: box.clientWidth / 2, y: box.clientHeight / 2, last: performance.now(), speed: 0, vx: 0, vy: 0, hovered: null, t: performance.now() },
            W: () => box.clientWidth, H: () => box.clientHeight, root: box, layer: box, staged: true,
            rect(el) {
                const s = box.getBoundingClientRect(), r = el.getBoundingClientRect();
                return { left: r.left - s.left, top: r.top - s.top, right: r.right - s.left, bottom: r.bottom - s.top, width: r.width, height: r.height };
            },
        };
        const inst = run(v, E);
        const P = E.P;
        return {
            P, inst,
            move(x, y) {
                const now = performance.now(), dt = Math.max(1, now - P.t);
                P.vx = (x - P.x) / dt; P.vy = (y - P.y) / dt; P.speed = Math.hypot(P.vx, P.vy);
                P.x = x; P.y = y; P.last = now; P.t = now;
                inst.on.move();
            },
            down(x, y) { this.move(x, y); inst.on.down({ clientX: x, clientY: y }); },
            scroll(dy) { inst.on.scroll(dy); },
            add(btn) { inst.on.trip({ dir: 1, btn, at: null }); },
            hover(el) { P.hovered = el; },
            pause: v => inst.pause(v),
            get bee() { return inst.pos; },
            destroy: () => inst.destroy(),
        };
    }

    function stop() {
        if (active) active.destroy();
        active = null;
        window.dispatchEvent(new CustomEvent('bogabee:bee', { detail: null }));
    }

    window.BogabeeBee = { VARIANTS, start, stop, stage, get current() { return active && active.variant; } };

    const OFF = 'bogabee-bee-off';
    const get = k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
    // The site flies the chosen bee; a bee picked in the lab sticks only while you're comparing.
    const choice = () => new URLSearchParams(location.search).get('bee') || (get('bogabee-bee-lab') && get('bogabee-bee')) || 'bogabee';

    // A quiet switch in the footer for anyone who'd rather not have the bee. Remembered for the visit.
    function addToggle() {
        const host = document.querySelector('footer .wrap') || document.querySelector('footer');
        if (!host) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'b2-toggle';
        const label = () => { btn.textContent = get(OFF) ? 'Show the bee' : 'Hide the bee'; };
        btn.addEventListener('click', () => {
            try { get(OFF) ? sessionStorage.removeItem(OFF) : sessionStorage.setItem(OFF, '1'); } catch (e) {}
            get(OFF) ? stop() : start(choice());
            label();
        });
        label();
        host.appendChild(btn);
    }

    function init() {
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);
        if (window.BOGABEE_BEE_MANUAL) return;
        addToggle();
        if (!get(OFF)) start(choice());
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
