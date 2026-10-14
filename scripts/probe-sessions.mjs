// Diagnostic: asks the cloud sessions API a few different ways and prints counts only (no titles, no tokens).
// Run after `npm run build`: node scripts/probe-sessions.mjs
import { readLogin } from '../dist/node/server/cloud.js';

const API = 'https://api.anthropic.com';
const login = await readLogin();
if (!login) { console.log('No Claude login found. Run `claude` and /login first.'); process.exit(1); }

const variants = [
  ['/v1/code/sessions', false],
  ['/v1/code/sessions?limit=100', false],
  ['/v1/code/sessions?tags=hearth-thread', false],
  ['/v1/code/sessions?tags[]=hearth-thread', false],
  ['/v1/code/sessions?include_all=true', false],
  ['/v1/sessions?beta=true', true],
  ['/v1/sessions?beta=true&limit=100', true],
];

for (const [path, beta] of variants) {
  try {
    const res = await fetch(API + path, { headers: {
      Authorization: `Bearer ${login.token}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      ...(beta ? { 'anthropic-beta': 'ccr-byoc-2025-07-29' } : {}),
      ...(login.organization ? { 'x-organization-uuid': login.organization } : {}),
    } });
    const body = res.ok ? await res.json() : null;
    const list = Array.isArray(body) ? body : body?.data ?? body?.sessions ?? [];
    const count = (key) => Object.entries(list.reduce((m, s) => {
      for (const v of [].concat(typeof key === 'function' ? key(s) : s[key] ?? '-')) m[v] = (m[v] ?? 0) + 1;
      return m;
    }, {})).map(([k, n]) => `${k}:${n}`).join(' ');
    console.log(`\n${path} → HTTP ${res.status}, ${list.length} sessions${body && typeof body === 'object' && !Array.isArray(body) ? `, keys: ${Object.keys(body).join(',')}` : ''}`);
    if (list.length) {
      console.log('  kind:', count('environment_kind'));
      console.log('  status:', count((s) => s.status ?? s.session_status ?? '-'));
      console.log('  tags:', count((s) => s.tags?.length ? s.tags : ['(none)']));
      console.log('  id prefix:', count((s) => String(s.id).split('_')[0]));
    }
    if (body?.next_cursor) console.log('  has next_cursor');
  } catch (e) { console.log(`\n${path} → ${e.message}`); }
}
