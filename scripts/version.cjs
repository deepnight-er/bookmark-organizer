const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const packagePath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'manifest.json');
const htmlPath = path.join(root, 'index.html');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const value = process.argv[2];
let parts = pkg.version.split('.').map(Number);
if (value === 'patch') parts[2]++;
else if (value === 'minor') { parts[1]++; parts[2] = 0; }
else if (value === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
else if (/^\d+\.\d+\.\d+$/.test(value || '')) parts = value.split('.').map(Number);
else throw new Error('Use patch, minor, major, or a three-part version such as 2.0.1.');
if (parts.some(part => part > 65535)) throw new Error('Chrome version components must be at most 65535.');
if (parts.every(part => part === 0)) throw new Error('Chrome versions must have at least one nonzero component.');
const version = parts.join('.');
const html = fs.readFileSync(htmlPath, 'utf8');
if (!/<span id="app-version">v[^<]+<\/span>/.test(html)) throw new Error('Version display was not found.');
pkg.version = version;
manifest.version = version;
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(htmlPath, html.replace(/<span id="app-version">v[^<]+<\/span>/, `<span id="app-version">v${version}</span>`));
process.stdout.write(`Version updated to ${version}.\n`);
