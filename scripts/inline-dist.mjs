// Inlines the Vite build into ONE self-contained, offline HTML file: dist-single/q-rex.html
import fs from 'node:fs';
import path from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_, f) => `<style>${fs.readFileSync(path.join(dist, f), 'utf8')}</style>`);
html = html.replace(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g, (_, f) => `<script type="module">${fs.readFileSync(path.join(dist, f), 'utf8').replace(/<\/script/g, '<\\/script')}</script>`);
html = html.replace(/<link rel="icon"[^>]*>/, '');
const out = new URL('../dist-single/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'q-rex.html'), html);
console.log('wrote', path.join(out, 'q-rex.html'), (html.length / 1024).toFixed(0) + ' kB');
