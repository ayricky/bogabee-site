import { requireOwner } from '../../../server/hub.js';
import { InputError } from '../../../server/store.js';
import { json } from '../../../server/http.js';

async function errors(context) {
    try { return await context.next(); }
    catch (err) {
        if (err instanceof InputError) return json({ error: err.message }, 400);
        console.error(err);
        return json({ error: 'Something went wrong saving that. Try again.' }, 500);
    }
}
export const onRequest = [context => requireOwner(context, { api: true }), errors];
