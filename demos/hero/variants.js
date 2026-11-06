// Ways to show the Market Day photo in the homepage hero. ../refined/?hero=split picks one;
// without ?hero the page shows the default (Framed). Runs right after the hero, before it paints.
(function () {
    const V = [
        { id: 'framed', name: 'Framed' },
        { id: 'split', name: 'Split screen' },
        { id: 'print', name: 'Snapshot', light: true },
        { id: 'arch', name: 'Arch' },
        { id: 'collage', name: 'Collage' },
        { id: 'full', name: 'Full screen' },
    ];
    window.BOGABEE_HEROES = V;
    const q = new URLSearchParams(location.search).get('hero');
    const v = V.find(x => x.id === q) || V[0];
    const hero = document.querySelector('.hero');
    hero.dataset.hero = v.id;
    const show = (sel, on) => hero.querySelectorAll(sel).forEach(el => { el.hidden = !on; });
    show('.hero-sticker', v.id === 'print' || v.id === 'arch');
    show('.hero-photo figcaption', v.id === 'print');
    show('.hero-extra', v.id === 'collage');
    show('.hero-extra img', v.id === 'collage');
    if (v.light) document.querySelector('.nav').classList.remove('on-dark');
    if (!q) return;

    // While comparing, a pill steps through the versions.
    const i = V.indexOf(v), at = k => V[(i + k + V.length) % V.length].id;
    const pill = document.createElement('nav');
    pill.className = 'hero-pick';
    pill.setAttribute('aria-label', 'Photo layout');
    pill.innerHTML = `<a href="?hero=${at(-1)}" aria-label="Previous layout">‹</a><span><b>${i + 1}/${V.length}</b> ${v.name}</span><a href="?hero=${at(1)}" aria-label="Next layout">›</a><a href="../hero/">All</a>`;
    document.body.appendChild(pill);
})();
