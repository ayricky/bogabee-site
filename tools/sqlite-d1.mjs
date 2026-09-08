// Local test/preview adapter. Production uses Cloudflare's D1 binding.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function localDatabase(path = ':memory:') {
  const database = new DatabaseSync(path);
  database.exec(readFileSync(new URL('../migrations/0001_dashboard.sql', import.meta.url), 'utf8'));
  database.exec(readFileSync(new URL('../migrations/0002_use_google_analytics.sql', import.meta.url), 'utf8'));
  function prepare(sql, values = []) {
    return {
      bind(...args) { return prepare(sql, args); },
      async all() { return { results: database.prepare(sql).all(...values) }; },
      async run() { const result = database.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; }
    };
  }
  return {
    prepare,
    async batch(statements) {
      database.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.all()); database.exec('COMMIT'); return results; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    close() { database.close(); }
  };
}
