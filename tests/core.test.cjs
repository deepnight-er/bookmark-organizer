const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Core = require('../core.js');

function fixture() {
  return [{ id: '0', title: '', children: [
    { id: '1', title: '书签栏', parentId: '0', folderType: 'bookmarks-bar', syncing: false, children: [
      { id: 'a', title: '阅读', parentId: '1', syncing: false, children: [
        { id: 'source', title: '书籍', parentId: 'a', syncing: false, children: ['one', 'two', 'three'].map((id, index) => ({ id, title: id, url: `https://example.com/${id}`, parentId: 'source', syncing: false, index })) }
      ] },
      { id: 'b', title: '学习', parentId: '1', syncing: false, children: [
        { id: 'target', title: '公开课程', parentId: 'b', syncing: false, children: [] }
      ] }
    ] },
    { id: '2', title: '其他书签', parentId: '0', folderType: 'other', syncing: false, children: [] },
    { id: 'account', title: '书签栏', parentId: '0', folderType: 'bookmarks-bar', syncing: true, children: [
      { id: 'synced', title: '账号书签', url: 'https://example.com/account', parentId: 'account', syncing: true, index: 0 }
    ] },
    { id: 'account-other', title: '其他书签', parentId: '0', folderType: 'other', syncing: true, children: [] }
  ] }];
}

function adapters(storage = new Map()) {
  const window = { BookmarkCore: Core };
  const context = { window, crypto, localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, URL, Date, Map, Set };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../adapter.js'), 'utf8'), context);
  return window.BookmarkAdapters;
}

function fakeApi() {
  const tree = fixture();
  let next = 100;
  const api = {
    tree,
    failId: null,
    getTree: async () => Core.copy(tree),
    get: async id => {
      const item = Core.indexTree(tree).get(id);
      if (!item) throw new Error('missing node');
      return [Core.copy(item.node)];
    },
    getChildren: async id => Core.copy(Core.indexTree(tree).get(id).node.children || []),
    create: async value => {
      const parent = Core.indexTree(tree).get(value.parentId).node;
      const index = value.index === undefined ? parent.children.length : Math.min(value.index, parent.children.length);
      const created = { ...value, id: String(next++), index, syncing: parent.syncing };
      if (!value.url) created.children = [];
      parent.children.splice(index, 0, created);
      parent.children.forEach((child, index) => { child.index = index; });
      return Core.copy(created);
    },
    move: async (id, target) => {
      if (id === api.failId) throw new Error('simulated failure');
      Core.moveInTree(tree, id, target.parentId, target.index);
      return Core.copy(Core.indexTree(tree).get(id).node);
    },
    update: async (id, value) => {
      if (id === api.failId) throw new Error('simulated failure');
      const node = Core.indexTree(tree).get(id).node;
      Object.assign(node, value);
      return Core.copy(node);
    },
    remove: async id => {
      if (id === api.failId) throw new Error('simulated failure');
      const indexed = Core.indexTree(tree);
      const node = indexed.get(id).node;
      if (node.children?.length) throw new Error('folder is not empty');
      const parent = indexed.get(node.parentId).node;
      parent.children = parent.children.filter(child => child.id !== id);
      parent.children.forEach((child, index) => { child.index = index; });
    }
  };
  return api;
}

test('moving a bookmark preserves its URL, identity and source indices', () => {
  const tree = fixture();
  const before = Core.indexTree(tree).get('two').node.url;
  Core.moveInTree(tree, 'two', 'target');
  assert.equal(Core.indexTree(tree).get('two').node.url, before);
  assert.deepEqual(Core.indexTree(tree).get('source').node.children.map(node => node.id), ['one', 'three']);
  assert.equal(Core.indexTree(tree).get('three').node.index, 1);
});

test('draft batch undo restores the original order', async () => {
  const adapter = adapters().draftAdapter({ tree: fixture() }, true);
  const result = await adapter.move(['two', 'one'], { category: '学习', section: '公开课程' });
  assert.equal(result.count, 2);
  assert.equal((await adapter.undo()).count, 2);
  const restored = Core.indexTree(await adapter.load()).get('source').node.children.map(node => node.id);
  assert.deepEqual(restored, ['one', 'two', 'three']);
});

test('draft changes survive a reload', async () => {
  const shared = new Map();
  const factory = adapters(shared);
  const first = factory.draftAdapter({ tree: fixture() }, false);
  await first.move(['one'], { category: '学习', section: '公开课程' });
  const second = factory.draftAdapter({ tree: fixture() }, false);
  assert.equal(Core.indexTree(await second.load()).get('one').node.parentId, 'target');
  assert.equal(second.history.length, 1);
});

test('account bookmarks get an account folder with the same logical path', async () => {
  const adapter = adapters().draftAdapter({ tree: fixture() }, true);
  await adapter.move(['synced'], { category: '学习', section: '公开课程' });
  const indexed = Core.indexTree(await adapter.load());
  const item = indexed.get('synced');
  assert.equal(item.node.syncing, true);
  assert.equal(item.parents[1].id, 'account-other');
  assert.deepEqual(item.parents.slice(-2).map(node => node.title), ['学习', '公开课程']);
});

test('dropping an existing URL moves the saved bookmark without adding a copy', async () => {
  const adapter = adapters().draftAdapter({ tree: fixture() }, true);
  await adapter.move([], { category: '学习', section: '' }, { url: 'https://example.com/one', title: 'existing' });
  const tree = await adapter.load();
  assert.equal(Core.bookmarks(tree).length, 4);
  assert.equal(Core.indexTree(tree).get('one').node.parentId, 'b');
});

test('dropping a new URL supports undo', async () => {
  const adapter = adapters().draftAdapter({ tree: fixture() }, true);
  await adapter.move([], { category: '学习', section: '公开课程' }, { url: 'https://new.example/', title: 'New' });
  assert.equal(Core.bookmarks(await adapter.load()).length, 5);
  await adapter.undo();
  assert.equal(Core.bookmarks(await adapter.load()).length, 4);
});

test('the same destination is a no-op and unsafe dropped URLs are rejected', async () => {
  const adapter = adapters().draftAdapter({ tree: fixture() }, true);
  assert.equal((await adapter.move(['one'], { category: '阅读', section: '书籍' })).count, 0);
  assert.equal(adapter.history.length, 0);
  assert.equal(Core.externalLink('javascript:alert(1)'), null);
  assert.equal(Core.externalLink('file:///private/example'), null);
  assert.equal(Core.externalLink('# comment\nhttps://example.com/').url, 'https://example.com/');
});

test('live batch undo restores order, including non-display selection order', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  await adapter.move(['two', 'one'], { category: '学习', section: '公开课程' });
  assert.equal((await adapter.undo()).count, 2);
  assert.deepEqual(Core.indexTree(api.tree).get('source').node.children.map(node => node.id), ['one', 'two', 'three']);
});

test('partially failed live batches retain an undo record for completed moves', async () => {
  const api = fakeApi();
  api.failId = 'two';
  const adapter = adapters().chromeAdapter(api);
  const result = await adapter.move(['one', 'two'], { category: '学习', section: '公开课程' });
  assert.equal(result.count, 1);
  assert.match(result.error, /未全部完成/);
  api.failId = null;
  await adapter.undo();
  assert.equal(Core.indexTree(api.tree).get('one').node.parentId, 'source');
  assert.equal(Core.indexTree(api.tree).get('two').node.parentId, 'source');
});

test('undo skips a bookmark moved elsewhere by a concurrent editor', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  await adapter.move(['one'], { category: '学习', section: '公开课程' });
  await api.move('one', { parentId: 'a' });
  const result = await adapter.undo();
  assert.equal(result.count, 0);
  assert.equal(result.skipped, 1);
  assert.equal(Core.indexTree(api.tree).get('one').node.parentId, 'a');
});

test('HTML export escapes bookmark titles and URL attributes', () => {
  const tree = fixture();
  const node = Core.indexTree(tree).get('one').node;
  node.title = '<script>alert("x")</script>';
  node.url = 'https://example.com/?a="test"&b=1';
  const html = Core.exportHtml(tree);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a=&quot;test&quot;&amp;b=1/);
  assert.doesNotMatch(html, /<script>/);
});

test('editing validates names and URLs while preserving unchanged legacy URLs', () => {
  assert.throws(() => Core.bookmarkDetails({ title: ' ', url: 'https://example.com' }), /名称/);
  assert.throws(() => Core.bookmarkDetails({ title: 'Name', url: 'javascript:alert(1)' }), /新网址/);
  assert.throws(() => Core.bookmarkDetails({ title: 'Name', url: 'https://user:pass@example.com' }), /用户名/);
  assert.deepEqual(Core.bookmarkDetails({ title: ' Name ', url: 'file:///tmp/doc.html' }), { title: 'Name', url: 'file:///tmp/doc.html' });
  assert.equal(Core.bookmarkDetails({ title: 'Name', url: 'chrome://bookmarks/' }, 'chrome://bookmarks/').url, 'chrome://bookmarks/');
});

for (const mode of ['draft', 'live']) {
  test(`${mode} edits name and URL, survives reload and supports undo`, async () => {
    const storage = new Map();
    const factory = adapters(storage);
    const api = fakeApi();
    const create = () => mode === 'live' ? factory.chromeAdapter(api) : factory.draftAdapter({ tree: fixture() }, false);
    const first = create();
    const original = Core.copy(Core.indexTree(await first.load()).get('one').node);
    await first.update('one', { title: '改名后的书签', url: 'https://updated.example.com/page' }, original);
    const second = create();
    const updated = Core.indexTree(await second.load()).get('one').node;
    assert.equal(updated.title, '改名后的书签');
    assert.equal(updated.url, 'https://updated.example.com/page');
    assert.equal(updated.parentId, original.parentId);
    assert.equal((await second.undo()).count, 1);
    assert.equal(Core.indexTree(await second.load()).get('one').node.title, original.title);
    assert.equal(Core.indexTree(await second.load()).get('one').node.url, original.url);
  });
}

test('live edit detects changes made while the editor was open', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  const [original] = await api.get('one');
  await api.update('one', { title: 'Updated elsewhere' });
  await assert.rejects(adapter.update('one', { title: 'My edit', url: original.url }, original), /其他操作修改/);
  assert.equal(adapter.history.length, 0);
});

test('edit undo preserves a newer external edit', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  await adapter.update('one', { title: 'My edit', url: 'https://example.com/new' });
  await api.update('one', { title: 'Newer external title' });
  const result = await adapter.undo();
  assert.equal(result.count, 0);
  assert.equal(result.skipped, 1);
  assert.equal((await api.get('one'))[0].title, 'Newer external title');
});

test('no-op edits do not create history and edits interleave with old move entries', async () => {
  const adapter = adapters().draftAdapter({ tree: fixture() }, true);
  assert.equal((await adapter.update('one', { title: 'one', url: 'https://example.com/one' })).count, 0);
  await adapter.move(['one'], { category: '学习', section: '' });
  await adapter.update('one', { title: 'Renamed', url: 'https://example.com/one' });
  await adapter.undo();
  await adapter.undo();
  assert.equal(Core.indexTree(await adapter.load()).get('one').node.parentId, 'source');
  assert.equal(Core.indexTree(await adapter.load()).get('one').node.title, 'one');
});

test('prefixes separate display labels and replace existing prefixes', () => {
  assert.deepEqual(Core.titleParts('文档 · 书籍说明'), { prefix: '文档', name: '书籍说明' });
  assert.deepEqual(Core.titleParts('普通名称'), { prefix: '', name: '普通名称' });
  assert.equal(Core.prefixedTitle(' 原型 ', ' 书籍 '), '原型 · 书籍');
  assert.equal(Core.prefixedTitle('', '书籍'), '书籍');
  assert.throws(() => Core.prefixedTitle('文档 · 原型', '书籍'), /前缀/);
});

for (const mode of ['draft', 'live']) {
  test(`${mode} applies a common prefix once and undoes the whole batch`, async () => {
    const api = fakeApi();
    const adapter = mode === 'draft' ? adapters().draftAdapter({ tree: fixture() }, true) : adapters().chromeAdapter(api);
    await adapter.update('one', { title: '原型 · one', url: 'https://example.com/one' });
    const result = await adapter.setPrefix(['one', 'two', 'one'], '文档');
    assert.equal(result.count, 2);
    assert.equal(Core.indexTree(await adapter.load()).get('one').node.title, '文档 · one');
    assert.equal((await adapter.setPrefix(['one', 'two'], '文档')).count, 0);
    assert.equal((await adapter.undo()).count, 2);
    assert.equal(Core.indexTree(await adapter.load()).get('one').node.title, '原型 · one');
    assert.equal(Core.indexTree(await adapter.load()).get('two').node.title, 'two');
  });
}

test('failed live prefix batches retain completed changes for undo', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  api.failId = 'two';
  const result = await adapter.setPrefix(['one', 'two'], '文档');
  assert.equal(result.count, 1);
  assert.match(result.error, /未全部/);
  api.failId = null;
  await adapter.undo();
  assert.equal((await api.get('one'))[0].title, 'one');
});

test('invalid draft prefix batches leave the original tree untouched', async () => {
  const adapter = adapters().draftAdapter({ tree: fixture() }, true);
  await assert.rejects(adapter.setPrefix(['one', 'missing'], '文档'), /不存在/);
  assert.equal(Core.indexTree(await adapter.load()).get('one').node.title, 'one');
  assert.equal(adapter.history.length, 0);
});

for (const mode of ['draft', 'live']) {
  test(`${mode} renames a first-level category and keeps bookmarks discoverable`, async () => {
    const storage = new Map();
    const factory = adapters(storage);
    const api = fakeApi();
    const create = () => mode === 'draft' ? factory.draftAdapter({ tree: fixture() }, false) : factory.chromeAdapter(api);
    const adapter = create();
    const result = await adapter.renameFolders({ category: '阅读', section: '' }, '工作空间');
    assert.equal(result.count, 1);
    const tree = await create().load();
    const names = Core.categoryNames(tree);
    assert.equal(names[0], '工作空间');
    assert.equal(names.includes('阅读'), false);
    const item = Core.bookmarks(tree).find(item => item.node.id === 'one');
    assert.equal(Core.describe(item, names).category, '工作空间');
    assert.equal(Core.describe(item, names).path, '工作空间 / 书籍');
    assert.equal((await adapter.undo()).rename.after, '阅读');
    assert.equal(Core.indexTree(await adapter.load()).get('a').node.title, '阅读');
  });

  test(`${mode} renames second-level folders and restores their original names`, async () => {
    const api = fakeApi();
    const adapter = mode === 'draft' ? adapters().draftAdapter({ tree: fixture() }, true) : adapters().chromeAdapter(api);
    await adapter.renameFolders({ category: '阅读', section: '书籍' }, '书籍产品');
    const tree = await adapter.load();
    assert.equal(Core.indexTree(tree).get('source').node.title, '书籍产品');
    assert.equal(Core.indexTree(tree).get('one').node.parentId, 'source');
    assert.equal((await adapter.undo()).count, 1);
    assert.equal(Core.indexTree(await adapter.load()).get('source').node.title, '书籍');
  });

  test(`${mode} renames matching account and device categories as one undoable operation`, async () => {
    const api = fakeApi();
    const adapter = mode === 'draft' ? adapters().draftAdapter({ tree: fixture() }, true) : adapters().chromeAdapter(api);
    await adapter.move(['synced'], { category: '阅读', section: '书籍' });
    const result = await adapter.renameFolders({ category: '阅读', section: '' }, '项目');
    assert.equal(result.count, 2);
    assert.equal(Core.catalog(await adapter.load(), ['项目'], []).find(category => category.title === '项目').variants.length, 2);
    assert.equal((await adapter.undo()).count, 2);
    assert.equal(Core.indexTree(await adapter.load()).get('synced').node.syncing, true);
  });
}

test('category discovery distinguishes a user category named like a browser root', async () => {
  const adapter = adapters().draftAdapter({ tree: fixture() }, true);
  await adapter.renameFolders({ category: '阅读', section: '' }, '书签栏');
  const tree = await adapter.load();
  const item = Core.bookmarks(tree).find(item => item.node.id === 'one');
  assert.equal(Core.describe(item, Core.categoryNames(tree)).path, '书签栏 / 书籍');
});

test('folder rename rejects collisions within the same level and preserves the tree', async () => {
  const adapter = adapters().draftAdapter({ tree: fixture() }, true);
  await assert.rejects(adapter.renameFolders({ category: '阅读', section: '' }, '学习'), /已有/);
  await assert.rejects(adapter.renameFolders({ category: '阅读', section: '书籍' }, ' '), /填写/);
  assert.equal(adapter.history.length, 0);
});

test('partial live folder rename failures keep completed changes undoable', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  await adapter.move(['synced'], { category: '阅读', section: '书籍' });
  const accountCategory = Core.catalog(api.tree, ['阅读'], [])[0].variants.find(node => node.syncing);
  api.failId = accountCategory.id;
  const result = await adapter.renameFolders({ category: '阅读', section: '' }, '新阅读');
  assert.equal(result.count, 1);
  assert.match(result.error, /未能改名/);
  assert.equal(Core.categoryNames(await adapter.load()).includes('阅读'), true);
  api.failId = null;
  assert.equal((await adapter.undo()).count, 1);
  assert.equal(Core.indexTree(api.tree).get('a').node.title, '阅读');
});

test('folder rename undo preserves external edits and avoids merging a newly created category', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  await adapter.renameFolders({ category: '阅读', section: '' }, '项目');
  await api.update('a', { title: 'External name' });
  assert.equal((await adapter.undo()).skipped, 1);
  await adapter.renameFolders({ category: 'External name', section: '' }, 'New name');
  await api.create({ parentId: '1', title: 'External name' });
  assert.equal((await adapter.undo()).skipped, 1);
  assert.equal((await api.get('a'))[0].title, 'New name');
});

function signature(tree, ids) { return Core.deletionSignature(Core.deletionPlan(tree, ids)); }

test('deletion plans deduplicate descendants and reject browser-owned folders', () => {
  const plan = Core.deletionPlan(fixture(), ['a', 'source', 'one']);
  assert.deepEqual(plan.nodes.map(node => node.id), ['three', 'two', 'one', 'source', 'a']);
  assert.equal(plan.bookmarks, 3);
  assert.equal(plan.folders, 2);
  assert.throws(() => Core.deletionPlan(fixture(), ['1']), /无法删除/);
});

for (const mode of ['draft', 'live']) {
  test(`${mode} deletes a folder and restores content and original sibling order`, async () => {
    const api = fakeApi();
    const adapter = mode === 'live' ? adapters().chromeAdapter(api) : adapters().draftAdapter({ tree: fixture() }, true);
    const before = await adapter.load();
    const result = await adapter.remove(['source'], signature(before, ['source']));
    assert.equal(result.count, 4);
    assert.equal(Core.bookmarks(await adapter.load()).length, 1);
    assert.equal((await adapter.undo()).count, 4);
    const folder = [...Core.indexTree(await adapter.load()).values()].find(item => item.node.title === '书籍').node;
    assert.deepEqual(folder.children.map(node => node.title), ['one', 'two', 'three']);
    assert.equal(folder.parentId, 'a');
  });

  test(`${mode} rejects a stale delete confirmation without removing content`, async () => {
    const api = fakeApi();
    const adapter = mode === 'live' ? adapters().chromeAdapter(api) : adapters().draftAdapter({ tree: fixture() }, true);
    const before = await adapter.load();
    await adapter.update('one', { title: 'changed', url: 'https://example.com/one' });
    await assert.rejects(adapter.remove(['one'], signature(before, ['one'])), /已变化/);
    assert.equal(Core.bookmarks(await adapter.load()).length, 4);
  });
}

test('live undo remaps earlier edit and move history after deletion restoration', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  await adapter.update('one', { title: 'edited', url: 'https://example.com/one' });
  await adapter.move(['one'], { category: '学习', section: '公开课程' });
  await adapter.remove(['b'], signature(await adapter.load(), ['b']));
  await adapter.undo();
  const restored = Core.bookmarks(await adapter.load()).find(item => item.node.title === 'edited').node;
  assert.notEqual(restored.id, 'one');
  assert.equal((await adapter.undo()).count, 1);
  assert.equal(Core.indexTree(await adapter.load()).get(restored.id).node.parentId, 'source');
  assert.equal((await adapter.undo()).count, 1);
  assert.equal(Core.indexTree(await adapter.load()).get(restored.id).node.title, 'one');
});

test('live delete preserves newly added folder children and retains partial undo', async () => {
  const api = fakeApi();
  const remove = api.remove;
  api.remove = async id => {
    await remove(id);
    if (id === 'one') await api.create({ parentId: 'source', title: 'new child', url: 'https://example.com/new' });
  };
  const adapter = adapters().chromeAdapter(api);
  const result = await adapter.remove(['source'], signature(await adapter.load(), ['source']));
  assert.equal(result.count, 3);
  assert.match(result.error, /新的内容/);
  assert.equal(Core.indexTree(await adapter.load()).get('source').node.children[0].title, 'new child');
  assert.equal((await adapter.undo()).count, 3);
  assert.equal(Core.indexTree(await adapter.load()).get('source').node.children.length, 4);
});

test('live restore retries after a partial failure without creating duplicates', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  await adapter.remove(['source'], signature(await adapter.load(), ['source']));
  const create = api.create;
  let fail = true;
  api.create = async value => { if (fail && value.title === 'two') throw new Error('restore failure'); return create(value); };
  const first = await adapter.undo();
  assert.match(first.error, /记录已保留/);
  assert.equal(adapter.history.length, 1);
  fail = false;
  const retry = await adapter.undo();
  assert.equal(retry.error, undefined);
  assert.equal(adapter.history.length, 0);
  assert.equal(Core.bookmarks(await adapter.load()).length, 4);
  assert.equal([...Core.indexTree(await adapter.load()).values()].filter(item => item.node.title === '书籍').length, 1);
});


test('live partial deletion failure keeps completed removals undoable', async () => {
  const api = fakeApi();
  api.failId = 'two';
  const adapter = adapters().chromeAdapter(api);
  const result = await adapter.remove(['source'], signature(await adapter.load(), ['source']));
  assert.equal(result.count, 1);
  assert.match(result.error, /未全部完成/);
  assert.equal(adapter.history.length, 1);
  assert.equal((await adapter.undo()).count, 1);
  assert.equal(Core.bookmarks(await adapter.load()).length, 4);
});

test('deleting account and device category variants preserves storage on restore', async () => {
  const api = fakeApi();
  const adapter = adapters().chromeAdapter(api);
  await adapter.move(['synced'], { category: '阅读', section: '书籍' });
  const tree = await adapter.load();
  const ids = Core.folderDeletionIds(tree, { category: '阅读', section: '' });
  assert.equal(ids.length, 2);
  await adapter.remove(ids, signature(tree, ids));
  await adapter.undo();
  const restored = Core.bookmarks(await adapter.load());
  assert.equal(restored.filter(item => item.node.syncing).length, 1);
  assert.equal(restored.filter(item => !item.node.syncing).length, 3);
  assert.equal(restored.find(item => item.node.title === '账号书签').parents[1].id, 'account-other');
});

function persistentStorage(initial = {}) {
  const values = Core.copy(initial);
  return {
    values, fail: false,
    async get(key) { return Core.copy({ [key]: values[key] || null }); },
    async set(value) { if (this.fail) throw new Error('quota'); Object.assign(values, Core.copy(value)); }
  };
}

function sharedLocks() {
  let tail = Promise.resolve();
  return { request(name, action) { const result = tail.then(action); tail = result.catch(() => {}); return result; } };
}

test('extension storage persists undo and reloads without Web Storage', async () => {
  const api = fakeApi();
  const storage = persistentStorage();
  const factory = adapters();
  const first = factory.chromeAdapter(api, storage);
  await first.load();
  await first.update('one', { title: 'stored edit', url: 'https://example.com/one' });
  const second = factory.chromeAdapter(api, storage);
  await second.load();
  assert.equal(second.history.length, 1);
  assert.equal((await second.undo()).count, 1);
  assert.equal(Core.indexTree(api.tree).get('one').node.title, 'one');
});

test('tabs serialize edits and keep both shared undo entries', async () => {
  const api = fakeApi();
  const storage = persistentStorage();
  const locks = sharedLocks();
  const factory = adapters();
  const first = factory.chromeAdapter(api, storage, locks);
  const second = factory.chromeAdapter(api, storage, locks);
  await Promise.all([first.load(), second.load()]);
  await Promise.all([
    first.update('one', { title: 'first tab', url: 'https://example.com/one' }),
    second.update('two', { title: 'second tab', url: 'https://example.com/two' })
  ]);
  await first.load();
  assert.equal(first.history.length, 2);
  await first.undo();
  await second.undo();
  assert.equal(Core.indexTree(api.tree).get('one').node.title, 'one');
  assert.equal(Core.indexTree(api.tree).get('two').node.title, 'two');
});

test('deletion stops before mutation when recovery storage is full', async () => {
  const api = fakeApi();
  const storage = persistentStorage();
  const adapter = adapters().chromeAdapter(api, storage);
  await adapter.load();
  storage.fail = true;
  const result = await adapter.remove(['source'], signature(await adapter.load(), ['source']));
  assert.equal(result.count, 0);
  assert.match(result.error, /删除前未能保存/);
  assert.equal(Core.bookmarks(api.tree).length, 4);
});

test('an interrupted pending removal is recovered after reopening', async () => {
  const api = fakeApi();
  const snapshot = Core.copy(Core.indexTree(api.tree).get('two').node);
  await api.remove('two');
  const storage = persistentStorage({ 'bookmark-organizer-live-history-v1': {
    history: [{ type: 'delete', removed: [], pending: snapshot, restoreIds: {}, moves: [], created: [] }], changes: []
  } });
  const adapter = adapters().chromeAdapter(api, storage);
  await adapter.load();
  assert.equal((await adapter.undo()).count, 1);
  assert.equal(Core.bookmarks(api.tree).length, 4);
});

test('legacy history migrates only after extension storage succeeds', async () => {
  const api = fakeApi();
  const memory = new Map();
  const factory = adapters(memory);
  const legacy = factory.chromeAdapter(api);
  await legacy.load();
  await legacy.update('one', { title: 'legacy edit', url: 'https://example.com/one' });
  const storage = persistentStorage();
  const migrated = factory.chromeAdapter(api, storage);
  await migrated.load();
  assert.equal(migrated.history.length, 1);
  assert.equal(memory.has('bookmark-organizer-live-history-v1'), false);
  await migrated.undo();
  assert.equal(Core.indexTree(api.tree).get('one').node.title, 'one');
});

test('a failed legacy migration keeps its original undo data available in memory', async () => {
  const api = fakeApi();
  const memory = new Map();
  const factory = adapters(memory);
  const legacy = factory.chromeAdapter(api);
  await legacy.update('one', { title: 'pending migration', url: 'https://example.com/one' });
  const storage = persistentStorage();
  storage.fail = true;
  const migrated = factory.chromeAdapter(api, storage);
  await migrated.load();
  assert.equal(migrated.history.length, 1);
  assert.equal(memory.has('bookmark-organizer-live-history-v1'), true);
  storage.fail = false;
  assert.equal((await migrated.undo()).count, 1);
  assert.equal(Core.indexTree(api.tree).get('one').node.title, 'one');
});


test('a new demo revision opens an independent draft and preserves the previous draft', async () => {
  const memory = new Map();
  const factory = adapters(memory);
  const previousSeed = { tree: fixture(), demoRevision: 'old-examples' };
  const previous = factory.draftAdapter(previousSeed, false);
  await previous.update('one', { title: 'saved old draft', url: 'https://example.com/one' });
  const replacement = factory.draftAdapter({ tree: fixture(), demoRevision: 'new-examples' }, false);
  assert.equal(Core.indexTree(await replacement.load()).get('one').node.title, 'one');
  const reopened = factory.draftAdapter(previousSeed, false);
  assert.equal(Core.indexTree(await reopened.load()).get('one').node.title, 'saved old draft');
});

for (const mode of ['draft', 'live']) {
  function structuralAdapter() {
    const api = fakeApi();
    const adapter = mode === 'live' ? adapters().chromeAdapter(api) : adapters().draftAdapter({ tree: api.tree }, true);
    return { api, adapter };
  }
  test(`${mode} creates both category levels and undoes in order`, async () => {
    const { adapter } = structuralAdapter();
    await adapter.organize({ kind: 'create', parentId: '1', title: '新分类' });
    let tree = await adapter.load();
    const parent = Core.catalog(tree, Core.categoryNames(tree), []).find(node => node.title === '新分类').variants[0];
    await adapter.organize({ kind: 'create', parentId: parent.id, title: '二级分类' });
    await assert.rejects(adapter.organize({ kind: 'create', parentId: 'source', title: '三级分类' }), /两层/);
    await assert.rejects(adapter.organize({ kind: 'create', parentId: '1', title: '新分类' }), /同名/);
    await adapter.undo(); await adapter.undo();
    assert.ok(!Core.categoryNames(await adapter.load()).includes('新分类'));
  });
  test(`${mode} reorders folders and restores their original positions`, async () => {
    const { adapter } = structuralAdapter();
    await adapter.organize({ kind: 'order', target: { category: '学习' }, direction: -1 });
    assert.deepEqual(Core.categoryNames(await adapter.load()), ['学习', '阅读']);
    await adapter.undo();
    assert.deepEqual(Core.categoryNames(await adapter.load()), ['阅读', '学习']);
  });
  test(`${mode} merges categories and restores removed folders and bookmark order`, async () => {
    const { adapter } = structuralAdapter();
    const original = await adapter.load();
    await adapter.organize({ kind: 'merge', source: { category: '阅读' }, target: { category: '学习' } });
    let tree = await adapter.load();
    assert.deepEqual(Core.categoryNames(tree), ['学习']);
    assert.equal(Core.bookmarks(tree).length, Core.bookmarks(original).length);
    const undone = await adapter.undo();
    assert.equal(undone.skipped, 0);
    tree = await adapter.load();
    assert.deepEqual(Core.categoryNames(tree), ['阅读', '学习']);
    const reading = Core.catalog(tree, Core.categoryNames(tree), []).find(node => node.title === '阅读');
    assert.deepEqual(reading.variants[0].children[0].children.map(node => node.title), ['one', 'two', 'three']);
    assert.deepEqual(Core.catalog(tree, Core.categoryNames(tree), []).find(node => node.title === '学习').sections.map(node => node.title), ['公开课程']);
  });
  test(`${mode} imports a backup, skips exact duplicates and undoes all new folders`, async () => {
    const { adapter } = structuralAdapter();
    const backup = Core.importForest({ tree: fixture() });
    const result = await adapter.organize({ kind: 'import', parentId: '2', forest: backup.forest });
    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 4);
    await adapter.undo();
    const data = Core.importForest([{ title: '旅行', children: [{ title: '地图', children: [{ title: '地图站', url: 'https://maps.example.org/' }] }] }]);
    await adapter.organize({ kind: 'import', parentId: '2', forest: data.forest });
    assert.equal(Core.bookmarks(await adapter.load()).length, 5);
    await adapter.undo();
    assert.equal(Core.bookmarks(await adapter.load()).length, 4);
    assert.equal(Core.indexTree(await adapter.load()).get('2').node.children.length, 0);
  });
}

test('merge confirmation rejects a changed source tree', () => {
  const tree = fixture();
  const signature = Core.deletionSignature(Core.deletionPlan(tree, ['a']));
  Core.indexTree(tree).get('one').node.title = 'changed';
  assert.throws(() => Core.structurePlan(tree, { kind: 'merge', source: { category: '阅读' }, target: { category: '学习' }, signature }), /变化/);
});

test('live partial merge can be undone without losing source order', async () => {
  const api = fakeApi(); const adapter = adapters().chromeAdapter(api);
  api.failId = 'two';
  const result = await adapter.organize({ kind: 'merge', source: { category: '阅读' }, target: { category: '学习' } });
  assert.match(result.error, /未全部/);
  assert.equal(Core.bookmarks(await adapter.load()).length, 4);
  api.failId = null;
  const undone = await adapter.undo();
  assert.equal(undone.skipped, 0);
  assert.deepEqual(Core.indexTree(await adapter.load()).get('source').node.children.map(node => node.id), ['one', 'two', 'three']);
});

test('live merge undo remaps older bookmark moves to restored folders', async () => {
  const api = fakeApi(); const adapter = adapters().chromeAdapter(api);
  await adapter.move(['one'], { category: '学习', section: '公开课程' });
  await adapter.organize({ kind: 'merge', source: { category: '阅读' }, target: { category: '学习' } });
  await adapter.undo(); await adapter.undo();
  const reading = Core.catalog(await adapter.load(), ['阅读', '学习'], []).find(node => node.title === '阅读');
  assert.deepEqual(reading.variants[0].children[0].children.map(node => node.title), ['one', 'two', 'three']);
});

test('import validates URLs and flattens deep folders to two levels', () => {
  const parsed = Core.importForest([{ title: '收藏', children: [{ title: '地区', children: [{ title: '城市', children: [{ title: '地图', url: 'https://example.org/map' }, { title: 'bad', url: 'javascript:alert(1)' }] }] }] }]);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.flattened, 1);
  assert.equal(parsed.forest[0].children[0].title, '地区 / 城市');
  assert.equal(parsed.forest[0].children[0].children[0].url, 'https://example.org/map');
  assert.throws(() => Core.importForest({ operations: [] }), /完整备份/);
});

test('duplicate detection keeps distinct query strings and fragments', () => {
  const tree = fixture(); const parent = Core.indexTree(tree).get('source').node;
  parent.children.push({ id: 'dup', parentId: parent.id, title: 'duplicate', url: parent.children[0].url });
  parent.children.push({ id: 'query', parentId: parent.id, title: 'query', url: parent.children[0].url + '?page=2' });
  parent.children.push({ id: 'hash', parentId: parent.id, title: 'hash', url: parent.children[0].url + '#section' });
  assert.deepEqual(Core.duplicateGroups(tree).map(group => group.map(node => node.id)), [['one', 'dup']]);
});

test('duplicate deletion refuses to remove copies after the chosen keeper disappears', async () => {
  const api = fakeApi(); const adapter = adapters().chromeAdapter(api);
  const plan = Core.deletionPlan(api.tree, ['two']);
  await api.remove('one');
  await assert.rejects(adapter.remove(['two'], Core.deletionSignature(plan), [{ id: 'one', url: 'https://example.com/one' }]), /保留/);
  assert.ok(Core.indexTree(api.tree).has('two'));
});

test('live merge retains a concurrently added source child and supports undo', async () => {
  const api = fakeApi(); const adapter = adapters().chromeAdapter(api);
  const move = api.move;
  let added = false;
  api.move = async (...args) => {
    const value = await move(...args);
    if (!added) { added = true; await api.create({ parentId: 'source', title: 'new', url: 'https://example.org/new' }); }
    return value;
  };
  const result = await adapter.organize({ kind: 'merge', source: { category: '阅读' }, target: { category: '学习' } });
  assert.match(result.error, /新内容/);
  assert.equal(Core.bookmarks(api.tree).length, 5);
  await adapter.undo();
  assert.deepEqual(Core.indexTree(api.tree).get('source').node.children.map(node => node.title), ['one', 'two', 'three', 'new']);
});

test('merging account and device variants keeps each bookmark in its own storage', async () => {
  const api = fakeApi();
  const account = Core.indexTree(api.tree).get('account').node;
  account.children.push({ id: 'account-a', parentId: account.id, title: '阅读', syncing: true, children: [{ id: 'account-book', parentId: 'account-a', title: 'account book', url: 'https://example.org/account-book', syncing: true, index: 0 }] });
  const adapter = adapters().chromeAdapter(api);
  await adapter.organize({ kind: 'merge', source: { category: '阅读' }, target: { category: '学习' } });
  const book = Core.indexTree(api.tree).get('account-book');
  assert.equal(book.node.syncing, true);
  assert.equal(book.parents.at(-1).title, '学习');
  assert.equal(book.parents.at(-1).syncing, true);
  await adapter.undo();
  assert.equal(Core.indexTree(api.tree).get('account-book').parents.at(-1).title, '阅读');
});

test('an interrupted merge removal restores the folder after reopening', async () => {
  const api = fakeApi();
  const snapshot = Core.copy(Core.indexTree(api.tree).get('target').node);
  delete snapshot.children;
  await api.remove('target');
  const storage = persistentStorage({ 'bookmark-organizer-live-history-v1': {
    history: [{ type: 'structure', removed: [], pending: snapshot, restoreIds: {}, moves: [], created: [] }], changes: []
  } });
  const adapter = adapters().chromeAdapter(api, storage);
  await adapter.load();
  const result = await adapter.undo();
  assert.equal(result.count, 1);
  assert.equal(Core.indexTree(await adapter.load()).get('b').node.children[0].title, '公开课程');
});

test('import unwraps marked browser roots and preserves adjacent loose bookmarks', () => {
  const parsed = Core.importForest([{ title: '书签栏', folderType: 'import-root', children: [{ title: '阅读', children: [] }] }, { title: 'loose', url: 'https://example.org/loose' }]);
  assert.equal(parsed.forest.length, 2);
  assert.equal(parsed.forest[0].title, '阅读');
  assert.equal(parsed.forest[1].url, 'https://example.org/loose');
});

for (const mode of ['draft','live']) {
  test(`${mode} places a dragged category before or after another and supports undo`, async () => {
    const api = fakeApi();
    const adapter = mode === 'live' ? adapters().chromeAdapter(api) : adapters().draftAdapter({ tree: api.tree }, true);
    const result = await adapter.organize({ kind:'place', source:{category:'阅读',section:''}, target:{category:'学习',section:''}, after:true });
    assert.equal(result.count, 1);
    assert.deepEqual(Core.categoryNames(await adapter.load()), ['学习','阅读']);
    await adapter.undo();
    assert.deepEqual(Core.categoryNames(await adapter.load()), ['阅读','学习']);
    const unchanged = await adapter.organize({ kind:'place', source:{category:'阅读',section:''}, target:{category:'学习',section:''}, after:false });
    assert.equal(unchanged.count, 0);
  });
}

test('drag placement rejects a different folder level and preserves all data', () => {
  const tree = fixture(); const original = Core.copy(tree);
  assert.throws(() => Core.structurePlan(tree, { kind:'place', source:{category:'阅读',section:'书籍'}, target:{category:'学习',section:''}, after:true }), /同级/);
  assert.deepEqual(tree,original);
});

test('extension opens the organizer on first install and focuses an existing tab on click', async () => {
  let clicked; let installed; const calls = [];
  const chrome = {
    action:{onClicked:{addListener(fn){clicked=fn;}}},
    runtime:{getURL: name => 'chrome-extension://test/' + name, getContexts: async()=>[], onInstalled:{addListener(fn){installed=fn;}}},
    tabs:{create:async value=>calls.push(['create',value]),update:async(id,value)=>calls.push(['update',id,value])},
    windows:{update:async(id,value)=>calls.push(['focus',id,value])}
  };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../background.js'),'utf8'),{chrome,console});
  installed({reason:'install'}); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0][0],'create');
  installed({reason:'update'}); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);
  chrome.runtime.getContexts=async()=>[{tabId:4,windowId:2}];
  await clicked();
  assert.equal(calls[1][0],'update'); assert.equal(calls[1][1],4);
  assert.equal(calls[2][0],'focus');
});

for (const mode of ['draft', 'live']) {
  test(`${mode} preserves a dropped bookmark edited outside the organizer`, async () => {
    const api = fakeApi();
    const memory = new Map();
    const factory = adapters(memory);
    const adapter = mode === 'live' ? factory.chromeAdapter(api) : factory.draftAdapter({ tree: api.tree }, false);
    const added = await adapter.move([], { category: '学习', section: '公开课程' }, { title: 'Original', url: 'https://example.org/new-link' });
    const id = added.entry.created[0].id;
    if (mode === 'live') await api.update(id, { title: 'Changed externally', url: 'https://example.org/changed' });
    else {
      const key = 'bookmark-organizer-public-demo-v1';
      const saved = JSON.parse(memory.get(key));
      Object.assign(Core.indexTree(saved.tree).get(id).node, { title: 'Changed externally', url: 'https://example.org/changed' });
      memory.set(key, JSON.stringify(saved));
    }
    const reopened = mode === 'live' ? adapter : factory.draftAdapter({ tree: api.tree }, false);
    const result = await reopened.undo();
    const node = Core.indexTree(await reopened.load()).get(id)?.node;
    assert.equal(result.skipped, 1);
    assert.equal(node.title, 'Changed externally');
    assert.equal(node.url, 'https://example.org/changed');
  });

  test(`${mode} undo also removes folders created for an account destination`, async () => {
    const api = fakeApi();
    const adapter = mode === 'live' ? adapters().chromeAdapter(api) : adapters().draftAdapter({ tree: api.tree }, true);
    const moved = await adapter.move(['synced'], { category: '学习', section: '公开课程' });
    assert.equal(moved.count, 1);
    assert.equal(Core.indexTree(await adapter.load()).get('account-other').node.children.length, 1);
    await adapter.undo();
    assert.equal(Core.indexTree(await adapter.load()).get('account-other').node.children.length, 0);
    assert.equal(Core.indexTree(await adapter.load()).get('synced').node.parentId, 'account');
  });
}

test('legacy added-bookmark history preserves entries without an original snapshot', async () => {
  const api = fakeApi();
  const storage = persistentStorage({ 'bookmark-organizer-live-history-v1': {
    history: [{ moves: [], created: [{ id: 'one', toParentId: 'source' }] }], changes: []
  } });
  const adapter = adapters().chromeAdapter(api, storage);
  const result = await adapter.undo();
  assert.equal(result.skipped, 1);
  assert.ok(Core.indexTree(await adapter.load()).has('one'));
});

test('import undo retains failed work and resumes after reopening without repeating successful steps', async () => {
  const api = fakeApi(); const storage = persistentStorage(); const factory = adapters();
  const first = factory.chromeAdapter(api, storage);
  await first.organize({ kind: 'import', parentId: '2', forest: [{ title: 'New folder', children: [
    { title: 'First', url: 'https://example.org/import-first' }, { title: 'Second', url: 'https://example.org/import-second' }
  ] }] });
  const failed = Core.bookmarks(api.tree).find(item => item.node.title === 'First').node;
  api.failId = failed.id;
  const partial = await first.undo();
  assert.equal(partial.count, 1);
  assert.match(partial.error, /进度已保留/);
  assert.equal(first.history.length, 1);
  assert.equal(Core.bookmarks(api.tree).length, 5);
  api.failId = null;
  const reopened = factory.chromeAdapter(api, storage);
  const final = await reopened.undo();
  assert.equal(final.count, 2);
  assert.equal(final.error, undefined);
  assert.equal(reopened.history.length, 0);
  assert.equal(Core.bookmarks(api.tree).length, 4);
  assert.equal(Core.indexTree(api.tree).get('2').node.children.length, 0);
});

test('merge undo restores removed folders once when bookmark moves need a retry', async () => {
  const api = fakeApi(); const storage = persistentStorage(); const factory = adapters();
  const first = factory.chromeAdapter(api, storage);
  await first.organize({ kind: 'merge', source: { category: '阅读' }, target: { category: '学习' } });
  api.failId = 'two';
  const partial = await first.undo();
  assert.match(partial.error, /进度已保留/);
  assert.equal(first.history.length, 1);
  api.failId = null;
  const reopened = factory.chromeAdapter(api, storage);
  const completed = await reopened.undo();
  assert.equal(completed.error, undefined);
  const reading = Core.catalog(await reopened.load(), ['阅读', '学习'], []).find(node => node.title === '阅读');
  assert.equal(reading.variants.length, 1);
  assert.equal(reading.variants[0].children.length, 1);
  assert.deepEqual(reading.variants[0].children[0].children.map(node => node.title), ['one', 'two', 'three']);
});

test('edit undo retains a transient failure and retries after the API recovers', async () => {
  const api = fakeApi(); const adapter = adapters().chromeAdapter(api);
  await adapter.update('one', { title: 'Edited', url: 'https://example.com/one' });
  api.failId = 'one';
  assert.match((await adapter.undo()).error, /进度已保留/);
  assert.equal(adapter.history.length, 1);
  api.failId = null;
  assert.equal((await adapter.undo()).count, 1);
  assert.equal(Core.indexTree(api.tree).get('one').node.title, 'one');
});

test('live mode without the bookmarks API reports an error', async () => {
  const adapter = adapters().chromeAdapter(undefined);
  assert.equal(adapter.mode, 'live');
  await assert.rejects(adapter.load(), /书签接口不可用/);
  assert.equal(adapter.history.length, 0);
});

test('an empty category with nested empty folders reports each directory and zero URLs', () => {
  const tree = fixture(); const source = Core.indexTree(tree).get('source').node;
  source.children = [{ id: 'empty-a', parentId: source.id, title: 'Empty A', children: [] }, { id: 'empty-b', parentId: source.id, title: 'Empty B', children: [] }];
  const summary = Core.folderSummary(tree, { category: '阅读', section: '书籍' });
  assert.equal(summary.bookmarks, 0);
  assert.equal(summary.folders, 3);
  assert.equal(summary.variants, 1);
  assert.deepEqual(summary.childNames, ['Empty A', 'Empty B']);
  assert.equal(Core.catalog(tree, ['阅读'], [])[0].sections[0].folderCount, 2);
  const plan = Core.deletionPlan(tree, ['source']);
  assert.equal(plan.bookmarks, 0); assert.equal(plan.folders, 3);
});

test('moving requires an explicit destination category', async () => {
  const tree = fixture();
  assert.throws(() => Core.resolveDestination(tree, { category: '', section: '' }, false, () => 'new'), /目标分类/);
  assert.deepEqual(Core.categoryNames([{id: '0',children:[{id:'1',parentId:'0',children:[]}]}]), []);
});
