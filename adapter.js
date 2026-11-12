(function () {
  'use strict';

  const Core = window.BookmarkCore;
  const storageKey = 'bookmark-organizer-public-demo-v1';
  const historyKey = 'bookmark-organizer-live-history-v1';

  function readSaved(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  }

  function writeSaved(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return '';
    } catch {
      return '浏览器未能暂存更改，关闭页面前请导出书签。';
    }
  }

  function editEntry(node, value, expected) {
    if (!node?.url) throw new Error('这条书签已不存在，请关闭编辑窗口并刷新。');
    if (expected && (node.title !== expected.title || node.url !== expected.url)) throw new Error('这条书签刚被其他操作修改，请关闭编辑窗口后重新打开。');
    const after = Core.bookmarkDetails(value, node.url);
    if (after.title === node.title && after.url === node.url) return null;
    return { type: 'update', id: node.id, before: { title: node.title, url: node.url }, after, moves: [], created: [], at: new Date().toISOString() };
  }

  function matchesDetails(node, details) {
    return node?.title === details.title && node?.url === details.url;
  }

  function confirmedPlan(tree, ids, signature) {
    const plan = Core.deletionPlan(tree, ids);
    if (Core.deletionSignature(plan) !== signature) throw new Error('待删除内容已变化，请取消后重新确认删除范围。');
    return plan;
  }

  function validateKeepers(tree, keepers) {
    const indexed = Core.indexTree(tree);
    for (const keeper of keepers) {
      if (indexed.get(keeper.id)?.node.url !== keeper.url) throw new Error('选定保留的书签已变化，请重新查重后确认。');
    }
  }

  function removeDraftNode(tree, id) {
    const indexed = Core.indexTree(tree);
    const node = indexed.get(id).node;
    const parent = indexed.get(node.parentId).node;
    parent.children = parent.children.filter(child => child.id !== id);
    parent.children.forEach((child, index) => { child.index = index; });
  }

  function remapHistory(history, ids) {
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      for (const key of Object.keys(value)) {
        if (['id', 'parentId', 'fromParentId', 'toParentId'].includes(key) && ids[value[key]]) value[key] = ids[value[key]];
        else visit(value[key]);
      }
    }
    history.forEach(visit);
  }

  function draftAdapter(seed, temporary) {
    const draftStorageKey = seed.demoRevision ? `${storageKey}-${seed.demoRevision}` : storageKey;
    const saved = temporary ? null : readSaved(draftStorageKey);
    const state = saved?.version === 1 && Array.isArray(saved.tree) ? saved : {
      version: 1, tree: Core.copy(seed.tree), history: [], changes: [], updatedAt: null
    };
    let warning = '';
    function save() {
      state.changes = state.changes.slice(-200);
      state.updatedAt = new Date().toISOString();
      warning = temporary ? '' : writeSaved(draftStorageKey, state);
    }
    function nextId() { return 'draft-' + crypto.randomUUID(); }
    function destination(target, syncing, entry) {
      const result = Core.resolveDestination(state.tree, target, syncing, nextId);
      for (const folder of result.created) entry.created.push({ id: folder.id, toParentId: folder.parentId, title: folder.title });
      return result.folder.id;
    }
    function record(entry) {
      if (entry.type !== 'update' && !entry.edits?.length && !entry.folders?.length && !entry.removed?.length && !entry.moves.length && !entry.created.length) return;
      state.history.push(entry);
      state.history = state.history.slice(-30);
      state.changes.push(Core.copy(entry));
      save();
    }
    return {
      mode: 'draft',
      get warning() { return warning; },
      get history() { return state.history; },
      get changes() { return state.changes; },
      get updatedAt() { return state.updatedAt; },
      async load() { return Core.copy(state.tree); },
      async organize(request) {
        const plan = Core.structurePlan(state.tree, request);
        const entry = { type: 'structure', removed: [], restoreIds: {}, moves: [], created: [], at: new Date().toISOString() };
        const ids = new Map();
        for (const step of plan.steps) {
          const parentId = ids.get(step.node.parentId) || step.node.parentId;
          if (step.action === 'create') {
            const parent = Core.indexTree(state.tree).get(parentId).node;
            const node = { ...Core.copy(step.node), id: nextId(), parentId };
            ids.set(step.node.id, node.id);
            parent.children.push(node);
            entry.created.push({ id: node.id, toParentId: parentId, title: node.title, url: node.url });
          } else if (step.action === 'move') {
            const toParentId = ids.get(step.toParentId) || step.toParentId;
            Core.moveInTree(state.tree, step.id, toParentId, step.toIndex);
            entry.moves.push({ id: step.id, fromParentId: step.fromParentId, fromIndex: step.fromIndex, toParentId, toIndex: step.toIndex });
          } else {
            removeDraftNode(state.tree, step.node.id);
            entry.removed.push(Core.copy(step.node));
          }
        }
        record(entry);
        return { count: plan.steps.length, imported: plan.imported, skipped: plan.skipped, error: '' };
      },
      async remove(ids, signature, keepers = []) {
        validateKeepers(state.tree, keepers);
        const plan = confirmedPlan(state.tree, ids, signature);
        for (const node of plan.nodes) removeDraftNode(state.tree, node.id);
        record({ type: 'delete', removed: plan.nodes, restoreIds: {}, moves: [], created: [], at: new Date().toISOString() });
        return { count: plan.nodes.length, error: '' };
      },
      async renameFolders(target, title) {
        const plan = Core.folderRenamePlan(state.tree, target, title);
        for (const folder of plan.folders) Object.assign(Core.indexTree(state.tree).get(folder.id).node, folder.after);
        record({ type: 'folderRename', ...plan, moves: [], created: [], at: new Date().toISOString() });
        return { count: plan.folders.length, rename: plan.rename, error: '' };
      },
      async update(id, value, expected) {
        const node = Core.indexTree(state.tree).get(id)?.node;
        const entry = editEntry(node, value, expected);
        if (!entry) return { count: 0 };
        Object.assign(node, entry.after);
        record(entry);
        return { count: 1 };
      },
      async setPrefix(ids, prefix) {
        const entry = { type: 'edit', edits: [], moves: [], created: [], at: new Date().toISOString() };
        const edits = [...new Set(ids)].map(id => {
          const node = Core.indexTree(state.tree).get(id)?.node;
          if (!node?.url) throw new Error('部分书签已不存在，请刷新后重试。');
          const title = Core.prefixedTitle(prefix, Core.titleParts(node.title).name || Core.hostLabel(node.url));
          return { node, edit: editEntry(node, { title, url: node.url }) };
        });
        for (const { node, edit } of edits) {
          if (!edit) continue;
          Object.assign(node, edit.after);
          entry.edits.push(edit);
        }
        record(entry);
        return { count: entry.edits.length, error: '' };
      },
      async move(ids, target, link) {
        const entry = { target: Core.copy(target), moves: [], created: [], at: new Date().toISOString() };
        const uniqueIds = [...new Set(ids)];
        if (link) {
          const existing = Core.bookmarks(state.tree).find(item => item.node.url === link.url);
          if (existing) uniqueIds.push(existing.node.id);
          else {
            const parentId = destination(target, false, entry);
            const parent = Core.indexTree(state.tree).get(parentId).node;
            const node = { id: nextId(), title: link.title, url: link.url, parentId, syncing: false, index: (parent.children || []).length };
            parent.children.push(node);
            entry.created.push({ id: node.id, toParentId: parentId, title: node.title, url: node.url });
          }
        }
        const indexed = Core.indexTree(state.tree);
        const originals = new Map(uniqueIds.map(id => {
          const node = indexed.get(id)?.node;
          if (!node?.url) throw new Error('部分书签已不存在，请刷新后重试。');
          return [id, { parentId: node.parentId, index: node.index ?? 0 }];
        }));
        for (const id of new Set(uniqueIds)) {
          const node = Core.indexTree(state.tree).get(id).node;
          const parentId = destination(target, Boolean(node.syncing), entry);
          if (node.parentId === parentId) continue;
          const moved = Core.moveInTree(state.tree, id, parentId);
          moved.fromIndex = originals.get(id).index;
          entry.moves.push(moved);
        }
        record(entry);
        return { entry, count: entry.moves.length + entry.created.filter(node => node.url).length, error: '' };
      },
      async undo() {
        const entry = state.history[state.history.length - 1];
        if (!entry) return { count: 0, skipped: 0 };
        let restoredCount = 0;
        if (entry.type === 'delete' || entry.type === 'structure' && (entry.removed.length || entry.pending)) {
          let count = 0;
          try {
            for (const snapshot of [...entry.removed].reverse()) {
              const indexed = Core.indexTree(state.tree);
              if (entry.restoreIds[snapshot.id]) {
                const restored = indexed.get(snapshot.id)?.node;
                if (!matchesDetails(restored, snapshot) || restored.parentId !== snapshot.parentId) throw new Error('已恢复的内容又被修改，请先核对。');
                continue;
              }
              const parent = indexed.get(snapshot.parentId)?.node;
              if (!parent || parent.url) throw new Error('原分类已变化，暂时无法恢复。');
              const node = Core.copy(snapshot);
              if (!node.url) node.children = [];
              parent.children.splice(Math.min(node.index, parent.children.length), 0, node);
              parent.children.forEach((child, index) => { child.index = index; });
              entry.restoreIds[node.id] = node.id;
              count++;
              save();
            }
          } catch (failure) { return { count, skipped: 0, error: '恢复尚未完成，可再次点击撤销继续。' + failure.message }; }
          if (entry.type === 'delete') {
            state.history.pop();
            state.changes.push({ type: 'undo', entry: Core.copy(entry), at: new Date().toISOString() });
            save();
            return { count, skipped: 0 };
          }
          restoredCount = count;
        }
        let count = restoredCount;
        let skipped = 0;
        const folderIds = new Set((entry.folders || []).map(folder => folder.id));
        for (const folder of entry.folders || []) {
          const indexed = Core.indexTree(state.tree);
          const node = indexed.get(folder.id)?.node;
          const parent = indexed.get(folder.parentId)?.node;
          const collision = parent?.children?.some(child => !child.url && child.title === folder.before.title && !folderIds.has(child.id));
          if (!node || node.title !== folder.after.title || node.parentId !== folder.parentId || collision) { skipped++; continue; }
          Object.assign(node, folder.before);
          count++;
        }
        for (const edit of entry.edits || (entry.type === 'update' ? [entry] : [])) {
          const node = Core.indexTree(state.tree).get(edit.id)?.node;
          if (matchesDetails(node, edit.after)) { Object.assign(node, edit.before); count++; }
          else skipped++;
        }
        const ordered = [...entry.moves].sort((a, b) => a.fromIndex - b.fromIndex);
        for (const moved of ordered) {
          const indexed = Core.indexTree(state.tree);
          const node = indexed.get(moved.id)?.node;
          if (!node || node.parentId !== moved.toParentId || !indexed.has(moved.fromParentId)) { skipped++; continue; }
          Core.moveInTree(state.tree, moved.id, moved.fromParentId, moved.fromIndex);
          count++;
        }
        for (const created of [...entry.created].reverse()) {
          const indexed = Core.indexTree(state.tree);
          const node = indexed.get(created.id)?.node;
          if (!node || node.parentId !== created.toParentId || !node.url && node.children?.length || created.title === undefined || !matchesDetails(node, created)) { skipped++; continue; }
          const parent = indexed.get(node.parentId).node;
          parent.children = parent.children.filter(child => child.id !== node.id);
          parent.children.forEach((child, index) => { child.index = index; });
          count++;
        }
        state.history.pop();
        state.changes.push({ type: 'undo', entry: Core.copy(entry), at: new Date().toISOString() });
        save();
        return { count, skipped, rename: entry.rename && count ? { ...entry.rename, before: entry.rename.after, after: entry.rename.before } : null };
      }
    };
  }

  function chromeAdapter(api, persistence = window.chrome?.storage?.local, locks = window.navigator?.locks) {
    if (!api?.getTree) return {
      mode: 'live', history: [], changes: [], warning: '', updatedAt: null,
      async load() { throw new Error('Chrome 书签接口不可用，请确认扩展已启用书签权限并重新加载。'); }
    };
    const state = { history: [], changes: [] };
    let updatedAt = null;
    let warning = '';
    let saves = Promise.resolve();
    let actions = Promise.resolve();
    function save() {
      state.changes = state.changes.slice(-200);
      const snapshot = Core.copy(state);
      saves = saves.then(async () => {
        try {
          if (persistence) await persistence.set({ [historyKey]: snapshot });
          else {
            const message = writeSaved(historyKey, snapshot);
            if (message) throw new Error(message);
          }
          warning = '';
        } catch { warning = '操作记录未能保存到本机，请导出书签后再关闭页面。'; }
      });
      return saves;
    }
    async function readHistory() {
      const saved = persistence ? (await persistence.get(historyKey))[historyKey] : readSaved(historyKey);
      state.history = Array.isArray(saved?.history) ? saved.history.slice(-30) : [];
      state.changes = Array.isArray(saved?.changes) ? saved.changes.slice(-200) : [];
    }
    const ready = (async () => {
      await readHistory();
      if (persistence && !state.history.length && !state.changes.length) {
        const legacy = readSaved(historyKey);
        if (legacy?.history?.length || legacy?.changes?.length) {
          state.history = legacy.history || [];
          state.changes = (legacy.changes || []).slice(-200);
          await save();
          if (!warning) localStorage.removeItem(historyKey);
        }
      }
    })();
    async function destination(tree, target, syncing, entry) {
      let counter = 0;
      const resolved = Core.resolveDestination(tree, target, syncing, () => 'pending-' + counter++);
      const ids = new Map();
      for (const folder of resolved.created) {
        const created = await api.create({ title: folder.title, parentId: ids.get(folder.parentId) || folder.parentId });
        ids.set(folder.id, created.id);
        entry.created.push({ id: created.id, toParentId: created.parentId, title: created.title });
      }
      return ids.get(resolved.folder.id) || resolved.folder.id;
    }
    const adapter = {
      mode: 'live',
      get warning() { return warning; },
      get history() { return state.history; },
      get changes() { return state.changes; },
      get updatedAt() { return updatedAt; },
      async load() {
        await ready;
        await saves;
        if (persistence && !warning) await readHistory();
        const tree = await api.getTree();
        updatedAt = new Date().toISOString();
        return tree;
      },
      async organize(request) {
        const plan = Core.structurePlan(await api.getTree(), request);
        const entry = { type: 'structure', removed: [], restoreIds: {}, moves: [], created: [], at: new Date().toISOString() };
        if (!plan.steps.length) return { count: 0, imported: plan.imported, skipped: plan.skipped, error: '' };
        state.history.push(entry);
        state.history = state.history.slice(-30);
        await save();
        if (warning) { state.history.pop(); throw new Error('整理前未能保存撤销记录，请释放存储空间后重试。'); }
        const ids = new Map();
        let count = 0;
        let error = '';
        try {
          for (const step of plan.steps) {
            const parentId = ids.get(step.node.parentId) || step.node.parentId;
            if (step.action === 'create') {
              const value = { parentId, title: step.node.title };
              if (step.node.url) value.url = step.node.url;
              const created = await api.create(value);
              ids.set(step.node.id, created.id);
              entry.created.push({ id: created.id, toParentId: parentId, title: created.title, url: created.url });
            } else {
              const [current] = await api.get(step.node.id);
              if (!matchesDetails(current, step.node) || current.parentId !== parentId || current.unmodifiable) throw new Error('内容已被其他操作修改，请刷新后重新预览。');
              if (step.action === 'move') {
                const toParentId = ids.get(step.toParentId) || step.toParentId;
                const moved = await api.move(step.id, { parentId: toParentId, index: step.toIndex });
                entry.moves.push({ id: step.id, fromParentId: parentId, fromIndex: step.fromIndex, toParentId: moved.parentId, toIndex: moved.index });
              } else {
                if ((await api.getChildren(current.id)).length) throw new Error('分类中出现新内容，已保留该分类。');
                entry.pending = step.node;
                await save();
                if (warning) throw new Error('删除空目录前无法保存恢复记录。');
                await api.remove(current.id);
                entry.removed.push(step.node);
                entry.pending = null;
              }
            }
            count++;
            await save();
            if (warning) throw new Error('撤销记录保存失败，操作已暂停。');
          }
        } catch (failure) { error = '整理未全部完成，可撤销已完成的步骤。' + failure.message; }
        if (!count && !entry.pending) state.history.pop();
        else state.changes.push(Core.copy(entry));
        await save();
        return { count, imported: plan.imported, skipped: plan.skipped, error };
      },
      async remove(ids, signature, keepers = []) {
        const tree = await api.getTree();
        validateKeepers(tree, keepers);
        const plan = confirmedPlan(tree, ids, signature);
        const entry = { type: 'delete', removed: [], restoreIds: {}, moves: [], created: [], at: new Date().toISOString() };
        let error = '';
        try {
          for (const node of plan.nodes) {
            if (keepers.length) validateKeepers(await api.getTree(), keepers);
            const [current] = await api.get(node.id);
            if (!matchesDetails(current, node) || current.parentId !== node.parentId || current.unmodifiable) throw new Error('内容刚被其他操作修改，请刷新后核对。');
            if (!node.url && (await api.getChildren(node.id)).length) throw new Error('分类中出现新的内容，已保留该分类。');
            if (!entry.removed.length) {
              state.history.push(entry);
              state.history = state.history.slice(-30);
            }
            entry.pending = node;
            await save();
            if (warning) throw new Error('删除前未能保存恢复记录，请释放存储空间后重试。');
            await api.remove(node.id);
            entry.removed.push(node);
            entry.pending = null;
            await save();
            if (warning) throw new Error('删除已暂停，请导出书签后核对操作记录。');
          }
        } catch (failure) { error = '删除未全部完成。' + failure.message; }
        if (!entry.removed.length) {
          state.history = state.history.filter(item => item !== entry);
          await save();
        }
        if (entry.removed.length) { state.changes.push(Core.copy(entry)); await save(); }
        return { count: entry.removed.length, error };
      },
      async renameFolders(target, title) {
        const plan = Core.folderRenamePlan(await api.getTree(), target, title);
        const entry = { type: 'folderRename', rename: plan.rename, folders: [], moves: [], created: [], at: new Date().toISOString() };
        let error = '';
        try {
          for (const folder of plan.folders) {
            const [current] = await api.get(folder.id);
            if (!current || current.title !== folder.before.title || current.parentId !== folder.parentId) throw new Error('文件夹刚被其他操作修改，请刷新后核对。');
            await api.update(folder.id, folder.after);
            entry.folders.push(folder);
          }
        } catch (failure) { error = '部分分类未能改名。' + failure.message; }
        if (entry.folders.length) {
          state.history.push(entry);
          state.history = state.history.slice(-30);
          state.changes.push(Core.copy(entry));
          await save();
        }
        return { count: entry.folders.length, rename: plan.rename, error };
      },
      async update(id, value, expected) {
        const [node] = await api.get(id);
        const entry = editEntry(node, value, expected);
        if (!entry) return { count: 0 };
        await api.update(id, entry.after);
        state.history.push(entry);
        state.history = state.history.slice(-30);
        state.changes.push(Core.copy(entry));
        await save();
        return { count: 1 };
      },
      async setPrefix(ids, prefix) {
        const entry = { type: 'edit', edits: [], moves: [], created: [], at: new Date().toISOString() };
        let error = '';
        try {
          for (const id of new Set(ids)) {
            const [node] = await api.get(id);
            if (!node?.url) throw new Error('部分书签已不存在，请刷新后重试。');
            const title = Core.prefixedTitle(prefix, Core.titleParts(node.title).name || Core.hostLabel(node.url));
            const edit = editEntry(node, { title, url: node.url });
            if (!edit) continue;
            await api.update(id, edit.after);
            entry.edits.push(edit);
          }
        } catch (failure) { error = '前缀未全部更新。' + failure.message; }
        if (entry.edits.length) {
          state.history.push(entry);
          state.history = state.history.slice(-30);
          state.changes.push(Core.copy(entry));
          await save();
        }
        return { count: entry.edits.length, error };
      },
      async move(ids, target, link) {
        const tree = await api.getTree();
        const indexed = Core.indexTree(tree);
        const uniqueIds = [...new Set(ids)];
        const entry = { target: Core.copy(target), moves: [], created: [], at: new Date().toISOString() };
        let error = '';
        if (link) {
          const existing = Core.bookmarks(tree).find(item => item.node.url === link.url);
          if (existing) uniqueIds.push(existing.node.id);
        }
        for (const id of uniqueIds) {
          if (!indexed.get(id)?.node.url) throw new Error('部分书签已被其他操作移除，请刷新后重试。');
        }
        try {
          const targets = new Map();
          for (const id of uniqueIds) {
            const node = indexed.get(id).node;
            const syncing = Boolean(node.syncing);
            if (!targets.has(syncing)) targets.set(syncing, await destination(Core.copy(tree), target, syncing, entry));
            const parentId = targets.get(syncing);
            const [current] = await api.get(id);
            if (!current) throw new Error('这条书签已被移除。');
            if (current.parentId === parentId) continue;
            const moved = await api.move(id, { parentId });
            const fromIndex = current.parentId === node.parentId ? node.index : current.index;
            entry.moves.push({ id, fromParentId: current.parentId, fromIndex, toParentId: moved.parentId, toIndex: moved.index });
          }
          if (link && uniqueIds.length === 0) {
            const parentId = await destination(Core.copy(tree), target, false, entry);
            const created = await api.create({ parentId, title: link.title, url: link.url });
            entry.created.push({ id: created.id, toParentId: parentId, title: created.title, url: created.url });
          }
        } catch (failure) {
          error = '移动未全部完成。' + failure.message;
        }
        if (entry.moves.length || entry.created.length) {
          state.history.push(entry);
          state.history = state.history.slice(-30);
          state.changes.push(Core.copy(entry));
          await save();
        }
        return { entry, count: entry.moves.length + entry.created.filter(node => node.url).length, error };
      },
      async undo() {
        const entry = state.history[state.history.length - 1];
        if (!entry) return { count: 0, skipped: 0 };
        let restoredCount = 0;
        if (entry.type === 'delete' || entry.type === 'structure' && !entry.foldersRestored && (entry.removed.length || entry.pending)) {
          if (entry.pending) {
            const current = Core.indexTree(await api.getTree()).get(entry.pending.id)?.node;
            if (!current) entry.removed.push(entry.pending);
            entry.pending = null;
            await save();
          }
          let count = 0;
          try {
            for (const snapshot of [...entry.removed].reverse()) {
              const parentId = entry.restoreIds[snapshot.parentId] || snapshot.parentId;
              if (entry.restoreIds[snapshot.id]) {
                const [restored] = await api.get(entry.restoreIds[snapshot.id]);
                if (!matchesDetails(restored, snapshot) || restored.parentId !== parentId) throw new Error('已恢复的内容又被修改，请先核对后重试。');
                continue;
              }
              const [parent] = await api.get(parentId);
              if (!parent || parent.url || parent.unmodifiable) throw new Error('原分类已变化，暂时无法恢复。');
              const children = await api.getChildren(parentId);
              const value = { parentId, title: snapshot.title, index: Math.min(snapshot.index, children.length) };
              if (snapshot.url) value.url = snapshot.url;
              const restored = await api.create(value);
              entry.restoreIds[snapshot.id] = restored.id;
              count++;
              await save();
            }
          } catch (failure) {
            await save();
            return { count, skipped: 0, error: '恢复尚未完成，撤销记录已保留，可再次点击撤销继续。' + failure.message };
          }
          if (entry.type === 'delete') {
            state.history.pop();
            remapHistory(state.history, entry.restoreIds);
            state.changes.push({ type: 'undo', entry: Core.copy(entry), at: new Date().toISOString() });
            await save();
            return { count, skipped: 0 };
          }
          remapHistory(state.history, entry.restoreIds);
          entry.foldersRestored = true;
          await save();
          if (warning) return { count, skipped: 0, error: '目录恢复进度暂未保存，请释放存储空间后再次点击撤销。' };
          restoredCount = count;
        }
        let count = restoredCount;
        let skipped = 0;
        entry.undoDone = entry.undoDone || [];
        const done = new Set(entry.undoDone.map(item => item.kind + ':' + item.id));
        const finished = (kind, id) => done.has(kind + ':' + id);
        async function complete(kind, id, outcome) {
          entry.undoDone.push({ kind, id, outcome });
          done.add(kind + ':' + id);
          if (outcome === 'restored') count++;
          if (outcome === 'skipped') skipped++;
          await save();
          if (warning) throw new Error('撤销进度暂未保存，请释放本机存储空间后继续。');
        }
        const indexed = Core.indexTree(await api.getTree());
        const folderIds = new Set((entry.folders || []).map(folder => folder.id));
        try {
          for (const folder of entry.folders || []) {
            if (finished('folder', folder.id)) continue;
            if (!indexed.has(folder.id)) { await complete('folder', folder.id, 'missing'); continue; }
            const [current] = await api.get(folder.id);
            const siblings = await api.getChildren(folder.parentId);
            const collision = siblings.some(child => !child.url && child.title === folder.before.title && !folderIds.has(child.id));
            if (current.title !== folder.after.title || current.parentId !== folder.parentId || collision) {
              await complete('folder', folder.id, 'skipped'); continue;
            }
            await api.update(folder.id, folder.before);
            await complete('folder', folder.id, 'restored');
          }
          for (const edit of entry.edits || (entry.type === 'update' ? [entry] : [])) {
            if (finished('edit', edit.id)) continue;
            if (!indexed.has(edit.id)) { await complete('edit', edit.id, 'missing'); continue; }
            const [node] = await api.get(edit.id);
            if (!matchesDetails(node, edit.after)) { await complete('edit', edit.id, 'skipped'); continue; }
            await api.update(edit.id, edit.before);
            await complete('edit', edit.id, 'restored');
          }
          for (const moved of [...entry.moves].sort((a, b) => a.fromIndex - b.fromIndex)) {
            if (finished('move', moved.id)) continue;
            if (!indexed.has(moved.id)) { await complete('move', moved.id, 'missing'); continue; }
            const [current] = await api.get(moved.id);
            if (current.parentId !== moved.toParentId || !indexed.has(moved.fromParentId)) {
              await complete('move', moved.id, 'skipped'); continue;
            }
            const [parent] = await api.get(moved.fromParentId);
            if (parent.url || parent.unmodifiable) { await complete('move', moved.id, 'skipped'); continue; }
            const children = await api.getChildren(parent.id);
            await api.move(moved.id, { parentId: parent.id, index: Math.min(moved.fromIndex, children.length) });
            await complete('move', moved.id, 'restored');
          }
          for (const created of [...entry.created].reverse()) {
            if (finished('created', created.id)) continue;
            if (!indexed.has(created.id)) { await complete('created', created.id, 'missing'); continue; }
            const [current] = await api.get(created.id);
            if (current.parentId !== created.toParentId || created.title === undefined || !matchesDetails(current, created)) {
              await complete('created', created.id, 'skipped'); continue;
            }
            if (!current.url && (await api.getChildren(current.id)).length) {
              await complete('created', created.id, 'skipped'); continue;
            }
            await api.remove(created.id);
            await complete('created', created.id, 'restored');
          }
        } catch (failure) {
          await save();
          return { count, skipped, error: '撤销尚未完成，进度已保留，可再次点击撤销继续。' + failure.message };
        }
        state.history.pop();
        state.changes.push({ type: 'undo', entry: Core.copy(entry), at: new Date().toISOString() });
        await save();
        const renamed = entry.undoDone.some(item => item.kind === 'folder' && item.outcome === 'restored');
        return { count, skipped, rename: entry.rename && renamed ? { ...entry.rename, before: entry.rename.after, after: entry.rename.before } : null };
      },
      subscribe(listener) {
        const events = [api.onCreated, api.onRemoved, api.onChanged, api.onMoved, api.onChildrenReordered, api.onImportEnded];
        for (const event of events) event?.addListener(listener);
        return () => { for (const event of events) event?.removeListener(listener); };
      }
    };
    for (const name of ['organize', 'renameFolders', 'update', 'setPrefix', 'move', 'remove', 'undo']) {
      const action = adapter[name];
      adapter[name] = (...args) => {
        const execute = async () => {
          await ready;
          await saves;
          if (warning) {
            await save();
            if (warning) throw new Error('操作记录尚未保存，请释放存储空间后重试。');
          }
          if (persistence) await readHistory();
          return action(...args);
        };
        const run = () => locks ? locks.request('bookmark-organizer-mutations', execute) : execute();
        const result = actions.then(run, run);
        actions = result.catch(() => {});
        return result;
      };
    }
    return adapter;
  }

  window.BookmarkAdapters = { draftAdapter, chromeAdapter };
})();
