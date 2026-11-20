import { requireOwner } from '../../server/hub.js';
export const onRequest = context => requireOwner(context, { api: false });
