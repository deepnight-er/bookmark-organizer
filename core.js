(function () {
  'use strict';

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function indexTree(tree) {
    const nodes = new Map();
    function visit(node, parents) {
      nodes.set(node.id, { node, parents });
      for (const child of node.children || []) visit(child, [...parents, node]);
    }
    for (const root of tree) visit(root, []);
    return nodes;
  }

  function bookmarks(tree) {
    return [...indexTree(tree).values()].filter(item => item.node.url);
  }

  function count(node) {
    return Number(Boolean(node.url)) + (node.children || []).reduce((sum, child) => sum + count(child), 0);
  }

  function folderCount(node) {
    return Number(!node.url) + (node.children || []).reduce((sum, child) => sum + folderCount(child), 0);
  }

  function folderSummary(tree, target) {
    const indexed = indexTree(tree);
    const nodes = folderDeletionIds(tree, target).map(id => indexed.get(id).node);
    return {
      bookmarks: nodes.reduce((sum, node) => sum + count(node), 0),
      folders: nodes.reduce((sum, node) => sum + folderCount(node), 0),
      variants: nodes.length,
      childNames: [...new Set(nodes.flatMap(node => (node.children || []).filter(child => !child.url).map(child => child.title)))]
    };
  }

  function categoryNames(tree, fallback = []) {
    const names = [];
    for (const { node, parents } of indexTree(tree).values()) {
      if (node.url || parents[parents.length - 1]?.parentId !== '0') continue;
      if (!names.includes(node.title)) names.push(node.title);
    }
    return names.length ? names : [...fallback];
  }

  function catalog(tree, categoryOrder, ignoredIds) {
    const ignored = new Set(ignoredIds);
    const result = categoryOrder.map(title => ({ title, count: 0, sections: [], variants: [] }));
    const byTitle = new Map(result.map(category => [category.title, category]));
    for (const item of indexTree(tree).values()) {
      const { node, parents } = item;
      if (node.url || !byTitle.has(node.title)) continue;
      const parent = parents[parents.length - 1];
      if (!parent || parent.parentId !== '0') continue;
      const category = byTitle.get(node.title);
      category.variants.push(node);
      category.count += count(node);
      for (const child of node.children || []) {
        if (child.url || (ignored.has(child.id) && count(child) === 0)) continue;
        let section = category.sections.find(section => section.title === child.title);
        if (!section) {
          section = { title: child.title, count: 0, folderCount: 0 };
          category.sections.push(section);
        }
        section.count += count(child);
        section.folderCount += folderCount(child) - 1;
      }
    }
    return result;
  }

  function describe(item, categoryOrder) {
    const category = item.parents.find((parent, index) => categoryOrder.includes(parent.title) && item.parents[index - 1]?.parentId === '0');
    const afterCategory = category ? item.parents.slice(item.parents.indexOf(category) + 1) : [];
    return {
      ...item.node,
      category: category ? category.title : '',
      section: afterCategory.map(parent => parent.title).join(' / '),
      sectionRoot: afterCategory[0]?.title || '',
      path: category ? [category.title, ...afterCategory.map(parent => parent.title)].join(' / ') : '未归类',
      host: hostLabel(item.node.url)
    };
  }

  function hostLabel(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') return '本地文件';
      return parsed.host.replace(/^www\./, '') || parsed.protocol;
    } catch {
      return url;
    }
  }

  function moveInTree(tree, id, parentId, requestedIndex) {
    const indexed = indexTree(tree);
    const item = indexed.get(id);
    const target = indexed.get(parentId);
    if (!item || item.node.parentId === '0' || !item.node.parentId || item.node.unmodifiable || item.node.folderType || item.parents.some(parent => parent.unmodifiable)) throw new Error('这项内容已不存在或无法移动。');
    if (target && (target.node.id === id || target.parents.some(parent => parent.id === id))) throw new Error('不能移入自身或下级分类。');
    if (!target || target.node.url || target.node.unmodifiable) throw new Error('目标文件夹已不存在或无法编辑。');
    const oldParent = indexed.get(item.node.parentId);
    if (!oldParent) throw new Error('原文件夹已不存在，请刷新后重试。');
    const fromIndex = oldParent.node.children.findIndex(child => child.id === id);
    oldParent.node.children.splice(fromIndex, 1);
    target.node.children = target.node.children || [];
    const toIndex = requestedIndex === undefined ? target.node.children.length : Math.max(0, Math.min(requestedIndex, target.node.children.length));
    target.node.children.splice(toIndex, 0, item.node);
    item.node.parentId = parentId;
    for (const parent of [oldParent.node, target.node]) {
      parent.children.forEach((child, index) => { child.index = index; });
    }
    return { id, fromParentId: oldParent.node.id, fromIndex, toParentId: parentId, toIndex };
  }

  function resolveDestination(tree, target, syncing, nextId) {
    if (!String(target?.category || '').trim()) throw new Error('请先新建或选择一个目标分类。');
    const indexed = indexTree(tree);
    const root = [...indexed.values()].find(({ node }) => node.folderType === 'other' && Boolean(node.syncing) === syncing)
      || [...indexed.values()].find(({ node }) => node.parentId === '0' && node.title === '其他书签' && Boolean(node.syncing) === syncing);
    let category = [...indexed.values()].find(({ node, parents }) => !node.url && node.title === target.category && Boolean(node.syncing) === syncing && parents[parents.length - 1]?.parentId === '0')?.node;
    const created = [];
    function addFolder(title, parent) {
      const folder = { id: nextId(), title, parentId: parent.id, syncing, children: [] };
      parent.children = parent.children || [];
      folder.index = parent.children.length;
      parent.children.push(folder);
      created.push(folder);
      return folder;
    }
    if (!category) {
      if (!root) throw new Error('找不到对应的账号或设备书签目录，请刷新后重试。');
      category = addFolder(target.category, root.node);
    }
    if (!target.section) return { folder: category, created };
    let section = (category.children || []).find(child => !child.url && child.title === target.section);
    if (!section) section = addFolder(target.section, category);
    return { folder: section, created };
  }

  function externalLink(data) {
    const candidate = String(data || '').split(/\r?\n/).find(line => line.trim() && !line.startsWith('#'))?.trim();
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return { url: url.href, title: hostLabel(url.href) };
    } catch {
      return null;
    }
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }

  function exportHtml(tree, ignoredIds = []) {
    const ignored = new Set(ignoredIds);
    const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>我的书签</TITLE>', '<H1>我的书签</H1>', '<DL><p>'];
    function visit(node, level) {
      if (ignored.has(node.id) && count(node) === 0) return;
      const indent = '    '.repeat(level);
      if (node.url) {
        lines.push(`${indent}<DT><A HREF="${escapeHtml(node.url)}">${escapeHtml(node.title)}</A>`);
        return;
      }
      lines.push(`${indent}<DT><H3${node.parentId === '0' ? ' DATA-BOOKMARK-ROOT="true"' : ''}>${escapeHtml(node.title)}</H3>`, `${indent}<DL><p>`);
      for (const child of node.children || []) visit(child, level + 1);
      lines.push(`${indent}</DL><p>`);
    }
    for (const root of tree) for (const child of root.children || []) visit(child, 1);
    lines.push('</DL><p>');
    return lines.join('\n');
  }

  function bookmarkDetails(value, originalUrl) {
    const title = String(value.title || '').trim();
    const url = String(value.url || '').trim();
    if (!title) throw new Error('请填写书签名称。');
    if (!url) throw new Error('请填写书签网址。');
    if (url !== originalUrl) {
      let parsed;
      try { parsed = new URL(url); }
      catch { throw new Error('网址格式不完整，请填写包含 https:// 的完整地址。'); }
      if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) throw new Error('新网址支持 HTTP、HTTPS 和本地文件地址。');
      if (parsed.username || parsed.password) throw new Error('请移除网址中的用户名或密码后再保存。');
    }
    return { title, url };
  }

  function titleParts(value) {
    const title = String(value || '');
    const separator = title.indexOf(' · ');
    if (separator <= 0) return { prefix: '', name: title };
    return { prefix: title.slice(0, separator).trim(), name: title.slice(separator + 3).trim() };
  }

  function prefixedTitle(prefix, name) {
    const cleanPrefix = String(prefix || '').trim();
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('请填写书签名称。');
    if (/[\r\n]/.test(cleanPrefix) || cleanPrefix.includes(' · ')) throw new Error('前缀请填写一段短文字，例如“文档”或“原型”。');
    return cleanPrefix ? cleanPrefix + ' · ' + cleanName : cleanName;
  }

  function folderRenamePlan(tree, target, value) {
    const title = String(value || '').trim();
    if (!title) throw new Error('请填写分类名称。');
    const catalogItems = catalog(tree, categoryNames(tree), []);
    const category = catalogItems.find(item => item.title === target.category);
    if (!category?.variants.length) throw new Error('这个分类已不存在，请刷新后重试。');
    const before = target.section || target.category;
    const rename = { category: target.category, section: target.section || '', before, after: title };
    if (before === title) return { rename, folders: [] };
    const siblings = target.section ? category.variants.flatMap(folder => folder.children || []).filter(node => !node.url) : catalogItems.flatMap(item => item.variants);
    if (siblings.some(node => node.title === title)) throw new Error('同一级已有这个分类名称，请换一个名称。');
    const folders = (target.section ? siblings.filter(node => node.title === before) : category.variants).map(node => {
      if (node.unmodifiable || node.folderType) throw new Error('这个文件夹由浏览器或管理员管理，无法改名。');
      return { id: node.id, parentId: node.parentId, before: { title: node.title }, after: { title } };
    });
    if (!folders.length) throw new Error('这个二级分类已不存在，请刷新后重试。');
    return { rename, folders };
  }

  function folderDeletionIds(tree, target) {
    const category = catalog(tree, categoryNames(tree), []).find(item => item.title === target.category);
    if (!category) throw new Error('分类已变化，请刷新后重试。');
    const folders = target.section ? category.variants.flatMap(folder => folder.children || []).filter(node => !node.url && node.title === target.section) : category.variants;
    if (!folders.length) throw new Error('分类已变化，请刷新后重试。');
    return folders.map(folder => folder.id);
  }

  function deletionPlan(tree, ids) {
    const indexed = indexTree(tree);
    const chosen = new Set(ids);
    const roots = [...chosen].map(id => {
      const item = indexed.get(id);
      if (!item) throw new Error('部分内容已变化，请刷新后重新确认删除。');
      return item;
    }).filter(item => !item.parents.some(parent => chosen.has(parent.id)));
    const nodes = [];
    function visit(node) {
      if (!node.parentId || node.parentId === '0' || node.folderType || node.unmodifiable) throw new Error('浏览器或管理员管理的文件夹无法删除。');
      for (const child of [...(node.children || [])].reverse()) visit(child);
      const snapshot = copy(node);
      delete snapshot.children;
      const parent = indexed.get(node.parentId)?.node;
      snapshot.index = parent.children.findIndex(child => child.id === node.id);
      nodes.push(snapshot);
    }
    roots.sort((a, b) => {
      const position = item => indexed.get(item.node.parentId).node.children.findIndex(child => child.id === item.node.id);
      return position(b) - position(a);
    }).forEach(item => visit(item.node));
    return { nodes, bookmarks: nodes.filter(node => node.url).length, folders: nodes.filter(node => !node.url).length };
  }

  function deletionSignature(plan) {
    return JSON.stringify(plan.nodes.map(node => [node.id, node.parentId, node.title, node.url || '']).sort((a, b) => a[0].localeCompare(b[0])));
  }


  function editableRoots(tree) {
    return [...indexTree(tree).values()].map(item => item.node).filter(node => node.parentId === '0' && !node.url && !node.unmodifiable && node.folderType !== 'managed');
  }

  function structurePlan(tree, request) {
    const working = copy(tree);
    const steps = [];
    const originals = indexTree(tree);
    let sequence = 0;
    const get = id => indexTree(working).get(id)?.node;
    function create(parentId, title, url) {
      const parent = get(parentId);
      if (!parent || parent.url || parent.unmodifiable) throw new Error('目标目录无法编辑，请刷新后重试。');
      const node = { id: 'pending-structure-' + sequence++, parentId, title, index: parent.children.length, syncing: Boolean(parent.syncing) };
      if (url) node.url = url;
      else node.children = [];
      parent.children.push(node);
      steps.push({ action: 'create', node: copy(node) });
      return node;
    }
    function move(node, parentId, index) {
      const before = copy(node);
      delete before.children;
      const moved = moveInTree(working, node.id, parentId, index);
      const original = originals.get(node.id)?.node;
      if (original?.parentId === before.parentId) moved.fromIndex = originals.get(original.parentId).node.children.findIndex(child => child.id === node.id);
      steps.push({ action: 'move', node: before, ...moved });
    }
    function remove(node) {
      if (node.children.length) throw new Error('分类仍有内容，无法完成合并。');
      const parent = get(node.parentId);
      const snapshot = { ...node, index: parent.children.findIndex(child => child.id === node.id) };
      delete snapshot.children;
      if (originals.has(node.id)) snapshot.index = originals.get(node.parentId).node.children.findIndex(child => child.id === node.id);
      parent.children = parent.children.filter(child => child.id !== node.id);
      parent.children.forEach((child, index) => { child.index = index; });
      steps.push({ action: 'remove', node: snapshot });
    }
    function folder(parent, title) {
      return parent.children.find(node => !node.url && node.title === title && !node.unmodifiable) || create(parent.id, title);
    }
    if (request.kind === 'create') {
      const title = String(request.title || '').trim();
      if (!title) throw new Error('请填写分类名称。');
      const parent = get(request.parentId);
      const depth = indexTree(working).get(request.parentId)?.parents.length;
      if (!parent || parent.url || depth < 1 || depth > 2 || parent.unmodifiable) throw new Error('请选择书签栏、其他书签或一级分类。最多支持两层分类。');
      if (parent.children.some(child => !child.url && child.title === title)) throw new Error('该目录已有同名分类。');
      create(parent.id, title);
    } else if (request.kind === 'order') {
      const ids = folderDeletionIds(working, request.target);
      if (![ -1, 1 ].includes(request.direction)) throw new Error('排序方向无效。');
      for (const id of ids) {
        const node = get(id);
        const parent = get(node.parentId);
        const siblings = parent.children.filter(child => !child.url && !child.unmodifiable && !child.folderType);
        const position = siblings.findIndex(child => child.id === id);
        const neighbour = siblings[position + request.direction];
        if (!neighbour) continue;
        move(node, parent.id, parent.children.findIndex(child => child.id === neighbour.id));
      }
    } else if (request.kind === 'place') {
      if (Boolean(request.source.section) !== Boolean(request.target.section)) throw new Error('请拖到同级分类之间调整顺序。');
      const sourceIds = folderDeletionIds(working, request.source);
      const targetIds = folderDeletionIds(working, request.target);
      if (sourceIds.some(id => targetIds.includes(id))) return { steps };
      let matchingParent = false;
      for (const id of sourceIds) {
        const node = get(id);
        const target = targetIds.map(get).find(folder => folder.parentId === node.parentId);
        if (!target) continue;
        matchingParent = true;
        const parent = get(node.parentId);
        const from = parent.children.findIndex(child => child.id === id);
        const to = parent.children.findIndex(child => child.id === target.id);
        const position = to - Number(from < to) + Number(Boolean(request.after));
        if (from !== position) move(node, parent.id, position);
      }
      if (!matchingParent) throw new Error('分类位于不同目录，无法在这里调整顺序。');
    } else if (request.kind === 'merge') {
      if (request.source.category === request.target.category && (request.source.section || '') === (request.target.section || '')) throw new Error('请选择另一个目标分类。');
      if (Boolean(request.source.section) !== Boolean(request.target.section)) throw new Error('请选择同级分类进行合并。');
      const sourceIds = folderDeletionIds(working, request.source);
      const current = deletionPlan(working, sourceIds);
      if (request.signature && deletionSignature(current) !== request.signature) throw new Error('来源分类已变化，请重新预览合并。');
      for (const id of sourceIds) {
        const source = get(id);
        if (source.unmodifiable) throw new Error('来源分类无法编辑。');
        const resolved = resolveDestination(working, request.target, Boolean(source.syncing), () => 'pending-structure-' + sequence++);
        for (const node of resolved.created) steps.push({ action: 'create', node: copy(node) });
        const target = resolved.folder;
        for (const child of [...source.children]) {
          if (!child.url && request.source.section) throw new Error('来源含有更深层文件夹，请先整理到两层分类后再合并。');
          if (child.url) move(child, target.id);
          else {
            if (child.children.some(node => !node.url)) throw new Error('来源含有更深层文件夹，请先整理到两层分类后再合并。');
            const section = folder(target, child.title);
            for (const bookmark of [...child.children]) move(bookmark, section.id);
            remove(child);
          }
        }
        remove(source);
      }
    } else if (request.kind === 'import') {
      const root = editableRoots(working).find(node => node.id === request.parentId);
      if (!root) throw new Error('请选择可编辑的浏览器目录。');
      const seen = new Set(bookmarks(working).map(item => item.node.url));
      let skipped = 0;
      let imported = 0;
      function addBookmark(node, parent) {
        if (seen.has(node.url)) { skipped++; return; }
        seen.add(node.url);
        create(parent.id, node.title, node.url);
        imported++;
      }
      for (const item of request.forest) {
        if (item.url) { addBookmark(item, root); continue; }
        const category = folder(root, item.title);
        for (const child of item.children) {
          if (child.url) addBookmark(child, category);
          else {
            const section = folder(category, child.title);
            for (const node of child.children) addBookmark(node, section);
          }
        }
      }
      return { steps, imported, skipped };
    } else throw new Error('无法识别这个整理操作。');
    return { steps };
  }

  function importForest(value) {
    let nodes = Array.isArray(value) ? value : value?.tree;
    if (!Array.isArray(nodes)) throw new Error('请选择书签 HTML 或完整备份 JSON。操作记录文件无法还原书签。');
    if (nodes.length === 1 && nodes[0].id === '0') nodes = nodes[0].children || [];
    nodes = nodes.flatMap(node => node?.parentId === '0' || node?.folderType ? node.children || [] : [node]);
    let skipped = 0;
    let flattened = 0;
    let total = 0;
    function bookmark(node) {
      try {
        if (++total > 20000) throw new Error('limit');
        const details = bookmarkDetails({ title: node.title || hostLabel(node.url), url: node.url });
        return details;
      } catch (failure) {
        if (total > 20000) throw new Error('单次最多导入 20,000 条书签。');
        skipped++;
        return null;
      }
    }
    const forest = [];
    for (const node of nodes) {
      if (!node || typeof node !== 'object') throw new Error('书签文件结构无效。');
      if (node.url) { const item = bookmark(node); if (item) forest.push(item); continue; }
      const category = { title: String(node.title || '导入书签'), children: [] };
      function visit(children, path, depth) {
        if (depth > 30) throw new Error('文件夹层级过深，请检查导入文件。');
        for (const child of children || []) {
          if (!child || typeof child !== 'object') throw new Error('书签文件结构无效。');
          if (child.url) {
            const item = bookmark(child);
            if (!item) continue;
            if (!path.length) category.children.push(item);
            else {
              const title = path.join(' / ');
              let section = category.children.find(node => !node.url && node.title === title);
              if (!section) { section = { title, children: [] }; category.children.push(section); }
              section.children.push(item);
            }
          } else {
            const next = [...path, String(child.title || '未命名分类')];
            if (next.length > 1) flattened++;
            if (!(child.children || []).length) category.children.push({ title: next.join(' / '), children: [] });
            visit(child.children, next, depth + 1);
          }
        }
      }
      visit(node.children, [], 0);
      forest.push(category);
    }
    return { forest, skipped, flattened };
  }

  function duplicateGroups(tree) {
    const groups = new Map();
    const order = categoryNames(tree);
    for (const item of bookmarks(tree)) {
      if (item.node.unmodifiable || item.parents.some(parent => parent.unmodifiable)) continue;
      if (!groups.has(item.node.url)) groups.set(item.node.url, []);
      groups.get(item.node.url).push(describe(item, order));
    }
    return [...groups.values()].filter(group => group.length > 1);
  }

  const api = { folderCount, folderSummary, editableRoots, structurePlan, importForest, duplicateGroups, copy, indexTree, bookmarks, count, categoryNames, catalog, describe, hostLabel, moveInTree, resolveDestination, externalLink, exportHtml, bookmarkDetails, titleParts, prefixedTitle, folderRenamePlan, folderDeletionIds, deletionPlan, deletionSignature };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.BookmarkCore = api;
})();
