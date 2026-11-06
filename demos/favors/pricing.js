// Party favor pricing, shared by the quote calculator and the owner hub. All amounts in cents.
// Production recomputes this on the server from the same table; the browser total is only a preview.
(function () {
    const JARS = {
        mini: { name: 'Mini jar', size: '2 oz', price: 300, img: 'product_stocking_stuffer.jpg' },
        small: { name: 'Small jar', size: '4 oz', price: 500, img: 'product8oz.jpg' },
        classic: { name: 'Classic jar', size: '8 oz', price: 800, img: 'product16oz.jpg' },
    };
    const ADDONS = {
        dipper: { name: 'Honey dipper', detail: 'Wooden dipper tied to the jar', price: 150 },
        charm: { name: 'Charm', detail: 'Decorative charm on the jar', price: 100 },
        ribbon: { name: 'Ribbon', detail: 'Satin bow in your color', price: 75 },
        twine: { name: 'Twine', detail: 'Natural jute wrap', price: 50 },
        label: { name: 'Custom label', detail: 'Your names, date or message', price: 100 },
    };
    const ASSEMBLY = {
        assembled: { name: 'Assembled', price: 100 },
        diy: { name: 'DIY kit', price: 0 },
    };
    const MIN_QTY = 10;
    const STEP = 5;
    // Above this, Danny quotes by hand (the order goes for approval instead of paying now).
    const MAX_QTY = 500;
    // Notice needed before the event date (placeholder until Danny sets it).
    const LEAD_DAYS = 14;

    // per jar = jar + each add-on + assembly; total = per jar × quantity
    function price(q) {
        const jar = JARS[q.jar];
        const qty = Math.max(MIN_QTY, Math.floor(q.qty) || 0);
        const lines = [{ label: `${jar.name} (${jar.size})`, each: jar.price }];
        for (const id of q.addons) lines.push({ label: ADDONS[id].name, each: ADDONS[id].price });
        const asm = ASSEMBLY[q.assembly];
        lines.push({ label: asm.name, each: asm.price });
        const perJar = lines.reduce((s, l) => s + l.each, 0);
        return { qty, lines, perJar, total: perJar * qty };
    }

    // Anything printed to order has to be checked by the owner before the customer can pay.
    const needsApproval = q => q.addons.includes('label') || Boolean(q.logoName) || q.qty > MAX_QTY;

    window.Favors = { JARS, ADDONS, ASSEMBLY, MIN_QTY, STEP, MAX_QTY, LEAD_DAYS, price, needsApproval };
})();
