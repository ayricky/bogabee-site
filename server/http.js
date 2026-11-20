export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});
export const html = (body, status = 200) => new Response(body, {
    status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
});
export const fail = (error, status = 400) => json({ error }, status);
