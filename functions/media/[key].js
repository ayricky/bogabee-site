// Photos uploaded in the hub.
export async function onRequestGet({ params, env }) {
    if (!env.MEDIA || !/^[\w.-]+$/.test(params.key)) return new Response('Not found', { status: 404 });
    const obj = await env.MEDIA.get(params.key);
    if (!obj) return new Response('Not found', { status: 404 });
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set('etag', obj.httpEtag);
    headers.set('x-content-type-options', 'nosniff');
    headers.set('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    return new Response(obj.body, { headers });
}
