// Cart drawer and add-to-cart controls for the homepages. Load after store.js and shop/shop.js.
(function () {
    const B = window.Bogabee;
    const base = new URL('./', document.currentScript.src);
    const checkoutUrl = new URL('shop/checkout/', base).href;
    // Pages with jars on them are where "Shop the jars" links return to.
    const hasJars = Boolean(document.querySelector('[data-add]'));
    if (hasJars) sessionStorage.setItem('bogabee-home', location.pathname);
    const jarsUrl = hasJars ? '#order' : B.shop.home() + '#order';

    const BAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1.2 11.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/></svg>';

    const drawer = document.createElement('dialog');
    drawer.className = 'cart-drawer';
    drawer.setAttribute('aria-labelledby', 'cart-title');
    drawer.innerHTML = `
        <div class="cart-panel">
            <header class="cart-head">
                <h2 id="cart-title" class="display">Your cart</h2>
                <button class="cart-close" type="button" aria-label="Close cart"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
            </header>
            <ul class="cart-lines" aria-live="polite"></ul>
            <div class="cart-empty">
                <p>Your cart is empty.</p>
                <a class="btn" href="${jarsUrl}" data-close>Shop the jars</a>
            </div>
            <footer class="cart-foot">
                <div class="cart-sum"><span>Subtotal</span><b data-subtotal></b></div>
                <a class="btn btn-dark btn-lg cart-checkout" href="${checkoutUrl}">Checkout</a>
            </footer>
        </div>`;
    document.body.append(drawer);
    // Announces adds that don't open the drawer.
    const status = document.createElement('p');
    status.className = 'visually-hidden';
    status.setAttribute('role', 'status');
    document.body.append(status);

    const lines = drawer.querySelector('.cart-lines');
    let lastTrigger = null;

    function open(trigger) {
        lastTrigger = trigger || document.activeElement;
        render();
        if (!drawer.open) drawer.showModal();
    }
    function close() {
        drawer.close();
    }
    drawer.addEventListener('close', () => lastTrigger && lastTrigger.focus && lastTrigger.focus());
    drawer.addEventListener('click', e => {
        if (e.target === drawer || e.target.closest('.cart-close, [data-close]')) close();
    });

    function render() {
        const items = B.cart.items();
        drawer.classList.toggle('is-empty', items.length === 0);
        lines.innerHTML = items.map(i => {
            const p = B.product(i.id);
            const max = B.shop.available(i.id);
            return `<li class="cart-line">
                <img src="${B.photo(p.img, 640)}" alt="" width="72" height="88">
                <div class="cart-line-text">
                    <b>${p.name}</b><span>${p.size}</span>
                    <button type="button" class="cart-remove" data-remove="${p.id}">Remove</button>
                </div>
                <div class="cart-line-side">
                    <span class="cart-line-price">${B.money(p.price * i.qty)}</span>
                    <div class="stepper" role="group" aria-label="${p.name} quantity">
                        <button type="button" data-step="-1" data-id="${p.id}" aria-label="One fewer ${p.name}">−</button>
                        <output aria-live="polite">${i.qty}</output>
                        <button type="button" data-step="1" data-id="${p.id}" aria-label="One more ${p.name}" ${i.qty >= max ? 'disabled' : ''}>+</button>
                    </div>
                </div>
            </li>`;
        }).join('');
        drawer.querySelector('[data-subtotal]').textContent = B.money(B.cart.subtotal());
        renderCount();
    }

    function renderCount() {
        const n = B.cart.count();
        document.querySelectorAll('[data-cart-count]').forEach(el => { el.textContent = n; el.hidden = n === 0; });
        // The button's name starts with its visible text ("Cart 2") and adds "items" for screen readers.
        document.querySelectorAll('[data-cart-open]').forEach(el => {
            el.removeAttribute('aria-label');
            const count = el.querySelector('.cart-count');
            if (count && count.previousSibling && count.previousSibling.nodeType === 3 && !/\s$/.test(count.previousSibling.textContent)) count.previousSibling.textContent += ' ';
            let sr = el.querySelector('.cart-sr');
            if (!sr) { sr = document.createElement('span'); sr.className = 'cart-sr visually-hidden'; el.append(sr); }
            sr.textContent = n ? ` item${n === 1 ? '' : 's'}` : '';
        });
        document.querySelectorAll('[data-add]').forEach(btn => {
            const id = btn.dataset.add;
            const left = B.shop.available(id);
            const inCart = (B.cart.items().find(i => i.id === id) || {}).qty || 0;
            const stock = document.querySelector(`[data-stock="${id}"]`);
            if (stock) { stock.hidden = left > B.shop.LOW_STOCK || left === 0; stock.textContent = `${left} left`; }
            btn.disabled = left === 0 || inCart >= left;
            btn.textContent = left === 0 ? 'Sold out' : inCart ? `Add another · ${inCart} in cart` : 'Add to cart';
        });
    }

    lines.addEventListener('click', e => {
        const step = e.target.closest('[data-step]');
        if (step) {
            const id = step.dataset.id;
            const cur = B.cart.items().find(i => i.id === id);
            B.cart.set(id, cur.qty + Number(step.dataset.step));
            render();
            // Keep focus on the same control after re-rendering.
            const again = lines.querySelector(`[data-id="${id}"][data-step="${step.dataset.step}"]`);
            (again && !again.disabled ? again : drawer.querySelector('.cart-close')).focus();
        }
        const remove = e.target.closest('[data-remove]');
        if (remove) { B.cart.set(remove.dataset.remove, 0); render(); drawer.querySelector('.cart-close').focus(); }
    });

    document.addEventListener('click', e => {
        const add = e.target.closest('[data-add]');
        if (add) {
            // The first jar opens the cart; after that, the Cart button takes the jar and the page stays put.
            const wasEmpty = B.cart.count() === 0;
            B.cart.add(add.dataset.add);
            if (wasEmpty) open(add);
            else {
                renderCount();
                const p = B.product(add.dataset.add);
                status.textContent = `${p.name} added. ${B.cart.count()} items in your cart.`;
                document.querySelectorAll('[data-cart-open]').forEach(b => { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); });
                add.textContent = 'Added';
                clearTimeout(add._t);
                add._t = setTimeout(renderCount, 1200);
            }
        }
        const openBtn = e.target.closest('[data-cart-open]');
        if (openBtn) { e.preventDefault(); open(openBtn); }
        // An empty cart has nothing to check out: show the drawer's empty state instead.
        const checkout = e.target.closest('[data-checkout]');
        if (checkout && B.cart.count() === 0) { e.preventDefault(); open(checkout); }
    });

    window.addEventListener('bogabee:change', () => (drawer.open ? render() : renderCount()));
    renderCount();
})();
