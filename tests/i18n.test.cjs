const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { languages, resolveLanguage, createTranslator } = require('../i18n.js');
const messages = require('../translations.js');
const Releases = require('../scripts/releases.cjs');
const root = path.resolve(__dirname, '..');

test('regional and script preferences resolve to supported languages', () => {
  for (const [preferences, expected] of [
    [['zh-Hant-HK'], 'zh-TW'], [['zh-Hans-HK'], 'zh-CN'], [['zh_SG'], 'zh-CN'],
    [['zh-MO'], 'zh-TW'], [['en-GB'], 'en'], [['de-AT'], 'de'], [['pt-PT'], 'pt-BR'],
    [['ar-SA'], 'ar'], [['unknown', 'ko-KR'], 'ko'], [['unsupported'], 'en']
  ]) assert.equal(resolveLanguage(preferences), expected);
});

test('all twelve catalogs contain every message and preserve placeholders', () => {
  assert.equal(languages.length, 12);
  assert(Object.keys(messages).length >= 440);
  const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
  for (const [source, values] of Object.entries(messages)) {
    for (const [code] of languages) {
      assert.equal(typeof values[code], 'string', code + ' ' + source);
      assert.deepEqual(placeholders(values[code]), placeholders(source), code + ' ' + source);
    }
  }
});

test('translations format values without changing user content or interpreting replacement syntax', () => {
  const translator = createTranslator(messages, 'de');
  const name = '删除 <img src=x> $& {7}';
  assert.equal(translator.t('分类已改名为「{0}」。', name), `Kategorie in „${name}“ umbenannt.`);
  assert.equal(translator.t('User-authored category'), 'User-authored category');
  translator.setLocale('ar');
  assert(translator.t('移动 {0} 条书签', 23).includes(new Intl.NumberFormat('ar').format(23)));
});

test('the English fallback is deterministic for missing catalog translations', () => {
  const translator = createTranslator({ example: { en: 'Fallback {0}' } }, 'ja');
  assert.equal(translator.t('example', 'value'), 'Fallback value');
  translator.setLocale('unsupported');
  assert.equal(translator.locale, 'en');
});

function runtime(saved = 'zh-TW', shouldFail = false) {
  const data = new Map(saved ? [['bookmark-organizer-language-v1', saved]] : []);
  const listeners = {};
  const select = { value: '', options: [], addEventListener(name, listener) { listeners[name] = listener; }, replaceChildren(...options) { this.options = options; } };
  const status = { textContent: '' };
  const document = {
    documentElement: {}, querySelectorAll: () => [], createElement: () => ({}),
    getElementById: id => id === 'language-select' ? select : status
  };
  const window = { BOOKMARK_TRANSLATIONS: messages, dispatchEvent() {}, addEventListener() {} };
  const storage = {
    getItem: key => data.get(key) || null,
    setItem(key, value) { if (shouldFail) throw new Error('quota'); data.set(key, value); }
  };
  const context = { window, document, navigator: { languages: ['en-US'] }, localStorage: storage, Event: class { constructor(type) { this.type = type; } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'i18n.js'), 'utf8'), context);
  return { window, document, select, status, data, listeners };
}

test('a saved manual language survives browser automatic initialization and reload', async () => {
  const first = runtime('zh-TW');
  await first.window.BookmarkI18n.ready;
  assert.equal(first.document.documentElement.lang, 'zh-TW');
  assert.equal(first.select.value, 'zh-TW');
  first.select.value = 'ar'; first.listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.data.get('bookmark-organizer-language-v1'), 'ar');
  assert.equal(first.document.documentElement.dir, 'rtl');
  const reopened = runtime(first.data.get('bookmark-organizer-language-v1'));
  await reopened.window.BookmarkI18n.ready;
  assert.equal(reopened.window.BookmarkI18n.locale, 'ar');
});

test('language storage failures keep the chosen interface and report the local save failure', async () => {
  const state = runtime(null, true);
  await state.window.BookmarkI18n.ready;
  state.select.value = 'fr'; state.listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.window.BookmarkI18n.locale, 'fr');
  assert.equal(state.data.size, 0);
  assert.equal(state.status.textContent, messages['语言设置暂用于当前页面。'].fr);
});

test('localized core messages preserve original bookmark titles and legacy root matching', () => {
  const translator = createTranslator(messages, 'en');
  const window = { BookmarkI18n: translator };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'core.js'), 'utf8'), { window, URL });
  const tree = [{ id:'0', title:'', children:[{id:'2', title:'其他书签', parentId:'0', children:[{id:'a',title:'删除',parentId:'2',children:[{id:'b',title:'保存',url:'https://example.com',parentId:'a'}]}]}]}];
  const core = window.BookmarkCore;
  assert.equal(core.describe(core.bookmarks(tree)[0], core.categoryNames(tree)).title, '保存');
  assert.equal(core.resolveDestination(tree, { category:'删除', section:'' }, false, ()=>'new').folder.id, 'a');
  assert.throws(() => core.bookmarkDetails({title:'',url:'https://example.com'}), /Enter a bookmark name/);
});

test('first-release metadata contains no invented public releases', () => {
  const data = Releases.readReleaseData();
  const initial = { version: '1.0.0', stage: 'unreleased', published: [], upcoming: ['feature'] };
  assert.equal(Releases.changelog(initial).includes('尚无公开发布版本。'), true);
  assert.equal(Releases.versionName(initial), '1.0.0 Preview');
  Releases.validateReleaseData(data, require('../package.json').version);
  assert.equal(fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8'), Releases.changelog(data));
});

test('published history validates dates, version identity and publication state', () => {
  const data = { version:'1.0.0', stage:'published', upcoming:['feature'], published:[{version:'1.0.0',date:'2026-11-12',features:['feature']}] };
  Releases.validateReleaseData(data, '1.0.0');
  assert.equal(Releases.versionName(data), '1.0.0');
  assert.throws(() => Releases.validateReleaseData({...data,stage:'unreleased'}, '1.0.0'), /contradicts/);
  assert.throws(() => Releases.validateReleaseData({...data,published:[{...data.published[0],date:'2026-02-31'}]}, '1.0.0'), /date/);
  assert.throws(() => Releases.validateReleaseData({...data,published:[...data.published,...data.published]}, '1.0.0'), /duplicate/);
});

test('version updates keep package, extension, page and release data synchronized without publishing', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-version-'));
  try {
    for (const name of ['package.json','manifest.json','index.html','releases.js','scripts/version.cjs','scripts/releases.cjs']) {
      const target = path.join(temporary,name); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(path.join(root,name),target);
    }
    const previous = Releases.readReleaseData();
    const parts = previous.version.split('.').map(Number);
    parts[2]++;
    const expected = parts.join('.');
    execFileSync(process.execPath, ['scripts/version.cjs','patch'],{cwd:temporary});
    assert.equal(JSON.parse(fs.readFileSync(path.join(temporary,'package.json'))).version, expected);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temporary,'manifest.json'))).version, expected);
    const context={window:{}}; vm.runInNewContext(fs.readFileSync(path.join(temporary,'releases.js'),'utf8'),context);
    assert.equal(context.window.BOOKMARK_RELEASES.version, expected);
    assert.equal(context.window.BOOKMARK_RELEASES.published.length, previous.published.length);
    assert(fs.readFileSync(path.join(temporary,'index.html'),'utf8').includes(`<span id="app-version">v${expected}</span>`));
  } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
});

test('release notes select only the current public version and draft notes preserve unreleased status', () => {
  const data = { version: '1.1.0', stage: 'published', upcoming: ['Future work'], published: [
    { version: '1.1.0', date: '2026-11-13', features: ['Current feature'] },
    { version: '1.0.0', date: '2026-11-12', features: ['Old feature'] }
  ] };
  const current = Releases.releaseNotes(data);
  assert.match(current, /Current feature/);
  assert(!current.includes('Old feature'));
  assert(!current.includes('Future work'));
  const draft = Releases.releaseNotes({ ...data, version: '1.2.0', stage: 'unreleased' });
  assert.match(draft, /准备发布/);
  assert.match(draft, /Future work/);
  assert(!draft.includes('Current feature'));
});
