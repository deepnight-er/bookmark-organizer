const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dataPath = path.join(root, 'releases.js');
function readReleaseData() {
  const source = fs.readFileSync(dataPath, 'utf8');
  const match = source.match(/^window\.BOOKMARK_RELEASES\s*=\s*([\s\S]+);\s*$/);
  if (!match) throw new Error('Invalid releases.js data');
  return JSON.parse(match[1]);
}
function validateReleaseData(data, version) {
  if (data.version !== version || !['unreleased', 'published'].includes(data.stage)) throw new Error('Release version or stage differs');
  const versions = new Set();
  for (const entry of data.published) {
    if (!/^\d+\.\d+\.\d+$/.test(entry.version) || versions.has(entry.version)) throw new Error('Invalid or duplicate release version');
    const date = new Date(entry.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== entry.date) throw new Error('Invalid public release date');
    if (!Array.isArray(entry.features) || !entry.features.length) throw new Error('Public release notes are empty');
    versions.add(entry.version);
  }
  if ((data.stage === 'published') !== versions.has(data.version)) throw new Error('Current release stage contradicts publication history');
  if (!Array.isArray(data.upcoming) || !data.upcoming.length) throw new Error('Upcoming release notes are empty');
}
function changelog(data) {
  const sections = ['# 版本更新记录', '<!-- Generated from releases.js. -->'];
  if (data.stage === 'unreleased') sections.push(`## ${data.version} · 准备发布\n\n` + data.upcoming.map(item => '- ' + item).join('\n'));
  for (const entry of data.published) sections.push(`## ${entry.version} · ${entry.date}\n\n` + entry.features.map(item => '- ' + item).join('\n'));
  if (!data.published.length) sections.push('尚无公开发布版本。');
  return sections.join('\n\n') + '\n';
}
function versionName(data) {
  return data.version + (data.stage === 'unreleased' ? ' Preview' : '');
}
function releaseNotes(data) {
  const entry = data.published.find(item => item.version === data.version);
  const features = entry ? entry.features : data.upcoming;
  return '# ' + data.version + (entry ? '\n\n' + entry.date : ' · 准备发布') + '\n\n' + features.map(item => '- ' + item).join('\n') + '\n';
}
if (require.main === module) {
  const data = readReleaseData();
  validateReleaseData(data, require('../package.json').version);
  if (process.argv[2] === '--notes') {
    if (!process.argv[3]) throw new Error('Provide an output path for release notes.');
    fs.writeFileSync(path.resolve(process.argv[3]), releaseNotes(data));
    console.log('Current-version release notes generated from releases.js.');
    return;
  }
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog(data));
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.version_name = versionName(data);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('Release notes generated from releases.js.');
}
module.exports = { readReleaseData, validateReleaseData, changelog, versionName, releaseNotes };
