// Renders docs/*.md to PDF (marked + headless chromium).  usage: node scripts/docs-pdf.mjs
import { marked } from 'marked';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const css = `body{font:12pt/1.6 system-ui,sans-serif;max-width:820px;margin:36px auto;padding:0 16px;color:#111}h1{font-size:20pt;border-bottom:2px solid #ff5400}h2{font-size:14pt;margin-top:1.4em}h3{font-size:12pt}table{border-collapse:collapse;width:100%;font-size:10pt;margin:12px 0}td,th{border:1px solid #999;padding:3px 6px;vertical-align:top}th{background:#eee}code,pre{font-family:ui-monospace,Menlo,monospace;font-size:9pt;background:#f3f3f3}pre{padding:8px;overflow:hidden;white-space:pre-wrap}`;
const dir = new URL('../docs/', import.meta.url).pathname;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
  const html = `<!doctype html><meta charset="utf-8"><style>${css}</style>${marked.parse(fs.readFileSync(path.join(dir, f), 'utf8'))}`;
  const h = path.join(dir, f.replace(/\.md$/, '.html'));
  fs.writeFileSync(h, html);
  execSync(`chromium --headless --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf="${h.replace(/\.html$/, '.pdf')}" "file://${h}"`, { stdio: 'ignore' });
  fs.unlinkSync(h);
  console.log('wrote', f.replace(/\.md$/, '.pdf'));
}
