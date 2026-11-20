import { json } from '../../../server/http.js';
export const onRequestGet = ({ data }) => json({ email: data.email });
