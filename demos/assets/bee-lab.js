// On the site, a small pill to step through the bee variations. It appears once you've
// picked a bee with ?bee= (from the Bee lab), and stays for the session.
(function () {
    const q = new URLSearchParams(location.search).get('bee');
    if (q) sessionStorage.setItem('bogabee-bee-lab', '1');
    if (!sessionStorage.getItem('bogabee-bee-lab') || !window.BogabeeBee) return;

    const { VARIANTS, start } = window.BogabeeBee;
    const style = document.createElement('style');
    style.textContent = `
    .bee-lab { position: fixed; z-index: 9001; top: 88px; left: 50%; translate: -50% 0; display: flex; align-items: center; gap: 4px; padding: 5px; border-radius: 99px; background: rgb(24 20 14 / .82); backdrop-filter: blur(14px); color: #fff; font: 500 13px/1 Jost, system-ui, sans-serif; box-shadow: 0 10px 30px rgb(0 0 0 / .25); max-width: calc(100vw - 24px); }
    .bee-lab button, .bee-lab a { display: grid; place-items: center; min-width: 34px; height: 34px; padding: 0 10px; border: 0; border-radius: 99px; background: none; color: rgb(255 255 255 / .75); font: inherit; cursor: pointer; text-decoration: none; }
    .bee-lab button:hover, .bee-lab a:hover { color: #fff; background: rgb(255 255 255 / .08); }
    .bee-lab output { padding: 0 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bee-lab output b { color: #f4d34a; font-weight: 500; }
    .bee-lab :focus-visible { outline: 2px solid #f4d34a; outline-offset: 1px; }
    @media (max-width: 640px) { .bee-lab { top: auto; bottom: calc(max(14px, env(safe-area-inset-bottom)) + 50px); font-size: 12px; } }`;
    document.head.appendChild(style);

    const bar = document.createElement('div');
    bar.className = 'bee-lab';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Bee variation');
    bar.innerHTML = `<button type="button" data-d="-1" aria-label="Previous bee">‹</button>
        <output aria-live="polite"></output>
        <button type="button" data-d="1" aria-label="Next bee">›</button>
        <a href="${new URL('../bees/', document.currentScript.src).href}" aria-label="All bees">All</a>`;
    document.body.appendChild(bar);
    const out = bar.querySelector('output');

    const show = v => {
        if (!v) return;
        const i = VARIANTS.indexOf(v);
        out.innerHTML = `<b>${i + 1}/${VARIANTS.length} ${v.name}</b> · ${v.tip}`;
    };
    bar.addEventListener('click', e => {
        const b = e.target.closest('[data-d]');
        if (!b) return;
        const i = VARIANTS.indexOf(window.BogabeeBee.current);
        start(VARIANTS[(i + Number(b.dataset.d) + VARIANTS.length) % VARIANTS.length].id);
    });
    window.addEventListener('bogabee:bee', e => show(e.detail));
    if (window.BogabeeBee.current) show(window.BogabeeBee.current);
})();
