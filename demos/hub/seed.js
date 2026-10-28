// Sample orders and quotes for the owner hub, so every screen (and the HubSpot sync) sees the same
// records no matter which screen opens first. Load after ../store.js on every hub page.
(function () {
    const B = window.Bogabee;
    const H = 3600e3, D = 24 * H;
    const isoDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };

    if (!localStorage.getItem(B.KEYS.orders)) {
        const now = Date.now();
        const yesterday = h => { const d = new Date(now - D); d.setHours(0, 0, 0, 0); return d.getTime() + h * H; };
        const line = (id, qty) => ({ id, qty, price: B.product(id).price });
        const make = o => { const subtotal = o.items.reduce((s, i) => s + i.price * i.qty, 0); return { ...o, subtotal, total: subtotal + o.fee }; };
        const list = [
            make({ id: 'BG-7Q2M', createdAt: now - 2 * H, status: 'paid', fulfillment: 'porch', fee: 0, method: 'Apple Pay', source: 'web',
                items: [line('signature-16', 2)], customer: { name: 'Maria Lopez', email: 'maria.lopez@example.com', phone: '' },
                pickup: { code: '418273', day: isoDay(new Date(now)), hour: new Date(now - H).getHours(), opened: [], usedAt: null, pickedUpAt: null } }),
            make({ id: 'BG-4KD9', createdAt: now - D - 5 * H, status: 'picked-up', fulfillment: 'porch', fee: 0, method: 'Visa •••• 4242', source: 'web',
                items: [line('small-8', 1), line('tasting', 1)], customer: { name: 'James Kim', email: 'james.kim@example.com', phone: '(732) 555-0144' },
                pickup: { code: '905531', day: isoDay(new Date(now - D)), hour: 15, opened: [yesterday(17.6)], usedAt: yesterday(17.6), pickedUpAt: yesterday(17.6) } }),
            make({ id: 'BG-9XRA', createdAt: now - 2 * D, status: 'paid', fulfillment: 'local', fee: 500, method: 'Visa •••• 4242', source: 'web',
                items: [line('signature-16', 3)], customer: { name: 'Priya Shah', email: 'priya.shah@example.com', phone: '(732) 555-0187' },
                address: { street: '12 Main St', city: 'Englishtown', state: 'NJ', zip: '07726' } }),
            make({ id: 'BG-2LPE', createdAt: now - 3 * D, status: 'shipped', fulfillment: 'ship', fee: 895, method: 'Google Pay', source: 'web',
                items: [line('small-8', 2)], customer: { name: 'Tom Russo', email: 'tom.russo@example.com', phone: '' },
                address: { street: '48 Oak Ave', city: 'Hoboken', state: 'NJ', zip: '07030' } }),
            make({ id: 'BG-8HTW', createdAt: now - 4 * D, status: 'picked-up', fulfillment: 'porch', fee: 0, method: 'Apple Pay', source: 'cabinet',
                items: [line('signature-16', 1)], customer: { name: 'Porch walk-up', email: '', phone: '' },
                pickup: { code: '662190', day: isoDay(new Date(now - 4 * D)), hour: 11, opened: [now - 4 * D + 60e3], usedAt: now - 4 * D + 60e3, pickedUpAt: now - 4 * D + 60e3 } }),
        ];
        localStorage.setItem(B.KEYS.orders, JSON.stringify(list));
    }

    // Totals follow the favors price table (favors/pricing.js), in cents.
    if (!localStorage.getItem(B.KEYS.quotes)) {
        const ago = h => Date.now() - h * H;
        const sample = [
            { id: 'Q-7K2M', at: ago(3), status: 'new', jar: 'classic', qty: 120, addons: ['dipper', 'ribbon', 'label'], assembly: 'assembled', labelText: 'Meant to Bee · Sarah & Mike', logoName: '', event: { type: 'Wedding', date: inDays(58), color: 'Sage' }, notes: 'Ribbon to match the sage table runners.', contact: { name: 'Sarah Whitman', email: 'sarah.whitman@example.com', phone: '(732) 555-0144' }, perJar: 1225, total: 147000 },
            { id: 'Q-3HQD', at: ago(26), status: 'approved', jar: 'small', qty: 40, addons: ['charm', 'twine', 'label'], assembly: 'assembled', labelText: 'Sweet as can bee · Baby Russo', logoName: '', event: { type: 'Baby shower', date: inDays(21), color: 'Blush' }, notes: '', contact: { name: 'Gina Russo', email: 'gina.russo@example.com', phone: '(908) 555-0172' }, payLink: 'https://bogabeeapiaries.com/pay/Q-3HQD', approvedAt: ago(20), perJar: 850, total: 34000 },
            { id: 'Q-9TFA', at: ago(50), status: 'new', jar: 'mini', qty: 150, addons: ['label'], assembly: 'diy', labelText: 'Thanks for a great year · Shore Point Realty', logoName: 'shore-point-logo.svg', event: { type: 'Corporate event', date: inDays(40), color: 'Navy' }, notes: 'Logo in navy on a white label if possible.', contact: { name: 'Dev Mehta', email: 'dev@shorepointrealty.example', phone: '(732) 555-0119' }, perJar: 400, total: 60000 },
            { id: 'Q-5WBN', at: ago(120), status: 'paid', jar: 'small', qty: 30, addons: ['dipper', 'twine'], assembly: 'assembled', labelText: '', logoName: '', event: { type: 'Bridal shower', date: inDays(9), color: 'Gold' }, notes: '', contact: { name: 'Priya Shah', email: 'priya.shah@example.com', phone: '(732) 555-0187' }, paidAt: ago(118), perJar: 800, total: 24000 },
        ];
        localStorage.setItem(B.KEYS.quotes, JSON.stringify(sample));
    }
})();
