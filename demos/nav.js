// On narrow screens the nav's text links don't fit. This adds a Menu button that opens them
// as a panel under the nav. Load on any page with <header class="nav">.
(function () {
    const nav = document.querySelector('.nav');
    const links = nav && nav.querySelector('.links');
    if (!links) return;
    const items = [...links.querySelectorAll('a:not(.btn)')];
    if (!items.length) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-menu-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'nav-panel');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>Menu</span>';
    links.prepend(btn);

    const panel = document.createElement('nav');
    panel.id = 'nav-panel';
    panel.className = 'nav-panel';
    panel.setAttribute('aria-label', 'Site');
    panel.hidden = true;
    panel.innerHTML = items.map(a => {
        const current = a.getAttribute('aria-current') ? ' aria-current="page"' : '';
        return `<a href="${a.getAttribute('href')}"${current}>${a.textContent.trim()}</a>`;
    }).join('');
    nav.appendChild(panel);

    const set = open => {
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', open);
        nav.classList.toggle('menu-open', open);
    };
    btn.addEventListener('click', () => set(panel.hidden));
    panel.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { set(false); btn.focus(); } });
    document.addEventListener('click', e => { if (!panel.hidden && !nav.contains(e.target)) set(false); });
    matchMedia('(min-width: 641px)').addEventListener('change', e => { if (e.matches) set(false); });
})();
