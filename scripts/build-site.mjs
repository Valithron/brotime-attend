import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
fs.mkdirSync(assets, { recursive: true });
const write = (name, content) => {
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
  const ext = path.extname(name);
  const target = `${path.basename(name, ext)}.${hash}${ext}`;
  fs.writeFileSync(path.join(assets, target), content);
  return '/assets/' + target;
};
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/bundle/manifest.json')));
const urls = {};
for (const [id, item] of Object.entries(manifest)) {
  let bytes = Buffer.from(item.data, 'base64');
  if (item.compressed) bytes = zlib.gunzipSync(bytes);
  urls[id] = write(id + (item.mime.includes('javascript') ? '.js' : '.woff2'), bytes);
}
let css = fs.readFileSync(path.join(root, 'src/app.css'), 'utf8');
for (const [id, url] of Object.entries(urls)) css = css.split(id).join(url);
const cssUrl = write('app.css', css);
const parts = ['config', 'rules', 'data', 'actions', 'selectors', 'component'].map(name => fs.readFileSync(path.join(root, `src/app/${name}.js`), 'utf8')).join('\n\n');
let html = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
html = html.replace(/<script src="125557a3-318f-4bc6-a6d9-2df5344dc562"><\/script>/, `<link rel="stylesheet" href="${cssUrl}">\n<script>window.__brotimeStatePromise=fetch('/api/state',{credentials:'same-origin',cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not load tracker.');return d;});window.__brotimeStatePromise.catch(()=>{});</script>\n<script defer src="${urls['c2a83737-9a18-4fef-a756-3185ed2ae073']}"></script>\n<script defer src="${urls['3bbeece5-af32-45a2-beeb-ff672c2dc649']}"></script>\n<script defer src="${urls['125557a3-318f-4bc6-a6d9-2df5344dc562']}"></script>`);
html = html.replace('<!-- APP_STYLES -->', '').replace('<!-- APP_SCRIPT -->', `<script type="text/x-dc" data-dc-script>${parts}</script>`);
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('Built directly served page and hashed assets.');
