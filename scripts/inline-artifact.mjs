// Folds the built cloud page's script and stylesheet into one HTML file: dist/agent-office.html.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../dist/cloud/', import.meta.url);
let html = readFileSync(new URL('cloud.html', dir), 'utf8');
const read = (href) => readFileSync(new URL(href.replace(/^\//, ''), dir), 'utf8');
const safe = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replace(/\uFFFD/g, '\\uFFFD');

html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>\n${read(href)}\n</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => `<script type="module">\n${safe(read(src))}\n</script>`);
// claude.ai wraps the page in its own document, so keep only what goes inside it.
html = html.replace(/<!doctype html>|<\/?html[^>]*>|<\/?head>|<\/?body>|<meta [^>]*>|<link rel="icon"[^>]*>/gi, '').trim();
writeFileSync(new URL('../dist/agent-office.html', import.meta.url), html);
console.log(`dist/agent-office.html: ${(html.length / 1024).toFixed(0)} KB`);
