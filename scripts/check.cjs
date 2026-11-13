const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const manifest = require('../manifest.json');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'seed.js'), 'utf8'), context);
const Core = require('../core.js');
const seed = context.window.BOOKMARK_SEED;
const allowedHosts = new Set(["apprendre.tv5monde.com", "archive.org", "collections.louvre.fr", "imslp.org", "learnenglish.britishcouncil.org", "learngerman.dw.com", "lnt.org", "naturalhistory.si.edu", "ocw.mit.edu", "openlibrary.org", "publicdomainreview.org", "standardebooks.org", "whc.unesco.org", "www.bbcgoodfood.com", "www.esa.int", "www.eso.org", "www.europeana.eu", "www.gutenberg.org", "www.khanacademy.org", "www.kingarthurbaking.com", "www.loc.gov", "www.metmuseum.org", "www.metoffice.gov.uk", "www.nasa.gov", "www.nationaltrust.org.uk", "www.noaa.gov", "www.nps.gov", "www.open.edu", "www.rijksmuseum.nl", "www.seriouseats.com", "www.timeanddate.com", "www.usgs.gov", "www.walkhighlands.co.uk", "www.weather.gov", "zh.wikisource.org", "zh.wikivoyage.org"]);
assert.equal(seed.demo, true);
assert.equal(Core.bookmarks(seed.tree).length, 36);
assert.equal(new Set(Core.bookmarks(seed.tree).map(item => item.node.url)).size, 36, 'Duplicate demo URL');
assert(seed.demoRevision, 'Demo revision is required');
for (const item of Core.bookmarks(seed.tree)) {
  const url = new URL(item.node.url);
  assert.equal(url.protocol, 'https:');
  assert(allowedHosts.has(url.hostname), 'Unexpected demo host');
  assert(!url.search && !url.username && !url.password, 'Demo URLs must be public and parameter-free');
  assert(item.parents.length <= 4, 'Demo folders exceed two user folder levels');
}
assert.equal(manifest.version, pkg.version);
assert.equal(manifest.minimum_chrome_version, '134');
assert.deepEqual(manifest.permissions, ['bookmarks', 'storage']);
for (const name of pkg.files) {
  const full = path.join(root, name);
  assert(fs.statSync(full).isFile());
  if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', full]);
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert(html.includes(`<span id="app-version">v${pkg.version}</span>`), 'Displayed version differs');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'Duplicate HTML IDs');
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (!match[1].startsWith('http') && match[1] !== 'download/extension.zip') assert(pkg.files.includes(match[1]), 'Unpackaged HTML asset');
}

if (process.argv.includes('--local')) {
  const configPath = path.join(root, 'private/local-targets.json');
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const local = path.resolve(root, config.extensionDirectory || 'dist/local/extension');
  for (const name of pkg.files) {
    assert(fs.readFileSync(path.join(local, name)).equals(fs.readFileSync(path.join(root, name))), `Local runtime differs: ${name}`);
  }
  console.log(`Local runtime matches version ${pkg.version}, ${pkg.files.length} files.`);
}

const Releases = require('./releases.cjs');
const release = Releases.readReleaseData();
Releases.validateReleaseData(release, pkg.version);
assert.equal(manifest.version_name, Releases.versionName(release), 'Run npm run releases to synchronize release display name');
assert.equal(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), Releases.changelog(release), 'Run npm run releases to synchronize public release notes');
const translations = require('../translations.js');
const languages = require('../i18n.js').languages.map(([code]) => code);
for (const [source, values] of Object.entries(translations)) {
  for (const code of languages) {
    assert.equal(typeof values[code], 'string', 'Missing translation: ' + code + ' ' + source);
    const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
    assert.deepEqual(placeholders(source), placeholders(values[code]), 'Translation placeholder mismatch');
  }
}
for (const feature of [...release.upcoming, ...release.published.flatMap(entry => entry.features)]) assert(translations[feature], 'Release note needs translations');

console.log(`Release checks passed. ${Core.bookmarks(seed.tree).length} public demo bookmarks, ${pkg.files.length} allowlisted files.`);
