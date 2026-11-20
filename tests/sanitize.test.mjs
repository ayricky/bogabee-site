import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, plain } from '../server/sanitize.js';

test('keeps the formatting the editor makes', () => {
    const html = '<p>Raw <strong>honey</strong>, <em>never</em> filtered.</p><h2>Why</h2><ul><li>One</li><li>Two</li></ul><blockquote><p>Q</p></blockquote><figure><img src="/media/a.jpg" alt="A jar"><figcaption>Cap</figcaption></figure><p>a<br>b</p>';
    assert.equal(sanitize(html), html);
});

test('drops scripts, handlers and styles', () => {
    assert.equal(sanitize('<p onclick="x()" style="color:red">Hi</p><script>alert(1)</script>'), '<p>Hi</p>');
    assert.equal(sanitize('<img src="/media/a.jpg" onerror="alert(1)">'), '<img src="/media/a.jpg" alt="">');
    assert.equal(sanitize('<style>p{}</style><iframe src="x"></iframe><p>ok</p>'), '<p>ok</p>');
    assert.equal(sanitize('<svg><script>alert(1)</script></svg>x'), 'x');
});

test('only safe link and image addresses survive', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', '&#106;avascript:alert(1)', 'data:text/html,x', '//evil.example', '/\\evil.example', 'vbscript:x'])
        assert.equal(sanitize(`<a href="${bad}">x</a>`), 'x', bad);
    assert.equal(sanitize('<a href="https://instagram.com/x">x</a>'), '<a href="https://instagram.com/x" target="_blank" rel="noopener">x</a>');
    assert.equal(sanitize('<a href="/apiary/">x</a>'), '<a href="/apiary/">x</a>');
    assert.equal(sanitize('<a href="mailto:a@b.c">x</a>'), '<a href="mailto:a@b.c">x</a>');
    assert.equal(sanitize('<img src="http://x/a.png">'), '');
    assert.equal(sanitize('<img src="data:image/png;base64,AAA">'), '');
});

test('text and attributes come out escaped', () => {
    assert.equal(sanitize('<p>1 < 2 & 3 > 2</p>'), '<p>1 &lt; 2 &amp; 3 &gt; 2</p>');
    assert.equal(sanitize('<img src="/a.jpg" alt="x&quot; onerror=&quot;alert(1)">'), '<img src="/a.jpg" alt="x&quot; onerror=&quot;alert(1)">');
    // A '>' inside a quoted attribute ends the tag early; the rest is shown as text, never as attributes.
    assert.equal(sanitize('<img src="/a.jpg" alt="a>b" onerror=alert(1)>'), '<img src="/a.jpg" alt="">b" onerror=alert(1)&gt;');
    assert.equal(sanitize('&lt;script&gt;alert(1)&lt;/script&gt;'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('closes what it opens and ignores stray closers', () => {
    assert.equal(sanitize('<p><strong>bold'), '<p><strong>bold</strong></p>');
    assert.equal(sanitize('</p>x</div>'), 'x');
    assert.equal(sanitize('<div><p>in a div</p></div>'), '<p>in a div</p>');
});

test('plain text for titles', () => {
    assert.equal(plain('  <b>Sun</b>flower &amp; bees  '), 'Sunflower & bees');
    assert.equal(plain('x'.repeat(500), 10).length, 10);
});
