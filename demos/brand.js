const heroImage = document.getElementById('hero-image');
if (heroImage && (location.search.includes('gigachad') || location.hash === '#gigachad')) {
    heroImage.removeAttribute('srcset');
    heroImage.src = '../assets/img/danny-chad.webp';
}

// Give the nav a solid background once the hero has scrolled away.
const nav = document.querySelector('.nav');
const hero = document.querySelector('.hero');
if (nav && hero) new IntersectionObserver(([e]) => nav.classList.toggle('is-solid', !e.isIntersecting), { rootMargin: '-80px 0px 0px 0px' }).observe(hero);

const reveal = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); }
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => reveal.observe(el));

document.querySelectorAll('[data-year]').forEach(el => { el.textContent = new Date().getFullYear(); });
