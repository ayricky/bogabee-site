import { importPKCS8, SignJWT } from 'jose';
import { shiftDay } from './dashboard.js';

let cachedToken;
async function accessToken(credentials) {
  if (cachedToken?.email === credentials.client_email && cachedToken.key === credentials.private_key && cachedToken.expires > Date.now() + 60000) return cachedToken.token;
  const key = await importPKCS8(credentials.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/analytics.readonly' })
    .setProtectedHeader({ alg: 'RS256' }).setIssuer(credentials.client_email)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Google authorization failed');
  const result = await response.json();
  if (typeof result.access_token !== 'string' || !Number.isFinite(result.expires_in)) throw new Error('Invalid Google token response');
  cachedToken = { email: credentials.client_email, key: credentials.private_key, token: result.access_token, expires: Date.now() + result.expires_in * 1000 };
  return result.access_token;
}

function rows(report, dimensions, metrics) {
  const headers = report.dimensionHeaders || [];
  if (!Array.isArray(headers) || !Array.isArray(report.metricHeaders) || (report.rows !== undefined && !Array.isArray(report.rows))) throw new Error('Invalid analytics report');
  if (headers.map(header => header.name).join() !== dimensions.join() || report.metricHeaders.map(header => header.name).join() !== metrics.join()) throw new Error('Unexpected analytics columns');
  return (report.rows || []).map(row => {
    const dimensionValues = row.dimensionValues || [];
    if (dimensionValues.length !== dimensions.length || row.metricValues?.length !== metrics.length) throw new Error('Invalid report row');
    const labels = dimensionValues.map(value => value.value);
    const values = row.metricValues.map(value => Number(value.value));
    if (labels.some(label => typeof label !== 'string') || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid report value');
    return { labels, values };
  });
}

export async function googleAnalytics(env, range) {
  if (!env.GA_PROPERTY_ID || !env.GA_SERVICE_ACCOUNT_JSON) return { state: 'unconfigured' };
  try {
    if (!/^\d+$/.test(env.GA_PROPERTY_ID)) throw new Error('Invalid property ID');
    const credentials = JSON.parse(env.GA_SERVICE_ACCOUNT_JSON);
    if (credentials.type !== 'service_account' || typeof credentials.client_email !== 'string' || typeof credentials.private_key !== 'string') throw new Error('Invalid Google credential');
    const token = await accessToken(credentials);
    const common = {
      dateRanges: [{ startDate: range.start, endDate: range.end }],
      dimensionFilter: { andGroup: { expressions: [
        { filter: { fieldName: 'hostName', inListFilter: { values: ['bogabeeapiaries.com', 'www.bogabeeapiaries.com'] } } },
        { notExpression: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/internal' } } } }
      ] } }
    };
    const requests = [
      { ...common, metrics: [{ name: 'screenPageViews' }, { name: 'sessions' }] },
      { ...common, dimensions: [{ name: 'date' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ dimension: { dimensionName: 'date' } }], limit: '100' },
      { ...common, dimensions: [{ name: 'pagePath' }], metrics: [{ name: 'screenPageViews' }], orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }], limit: '10' },
      { ...common, dimensions: [{ name: 'sessionSource' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: '10' }
    ];
    const response = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${env.GA_PROPERTY_ID}:batchRunReports`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ requests }), signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Google Analytics unavailable');
    const result = await response.json();
    if (result.reports?.length !== 4) throw new Error('Incomplete analytics response');
    const [totals, dates, pages, sources] = result.reports;
    const total = rows(totals, [], ['screenPageViews', 'sessions'])[0]?.values || [0, 0];
    const dailyRows = rows(dates, ['date'], ['screenPageViews']);
    const byDay = new Map(dailyRows.map(row => {
      if (!/^\d{8}$/.test(row.labels[0])) throw new Error('Invalid analytics date');
      const day = row.labels[0].replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
      return [day, row.values[0]];
    }));
    const limited = result.reports.some(report => report.metadata?.subjectToThresholding || report.metadata?.dataLossFromOtherRow || report.metadata?.samplingMetadatas?.length);
    return {
      state: 'ready', pageviews: total[0], sessions: total[1], source: 'Google Analytics', limited,
      timeZone: totals.metadata?.timeZone || 'Property time zone',
      daily: Array.from({ length: range.days }, (_, index) => { const day = shiftDay(range.start, index); return { day, count: byDay.get(day) || 0 }; }),
      pages: rows(pages, ['pagePath'], ['screenPageViews']).map(row => ({ label: row.labels[0], count: row.values[0] })),
      sources: rows(sources, ['sessionSource'], ['sessions']).map(row => ({ label: row.labels[0] === '(direct)' ? 'Direct' : row.labels[0], count: row.values[0] }))
    };
  } catch { return { state: 'unavailable' }; }
}
