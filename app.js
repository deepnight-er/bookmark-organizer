(function () {
  'use strict';

  const Core = window.BookmarkCore;
  const seed = window.BOOKMARK_SEED;
  const live = location.protocol === 'chrome-extension:';
  const temporary = new URLSearchParams(location.search).get('qa') === '1';
  const adapter = live ? window.BookmarkAdapters.chromeAdapter(window.chrome?.bookmarks) : window.BookmarkAdapters.draftAdapter(seed, temporary);
  const ignoredFolderIds = live ? [] : seed.ignoredEmptyFolderIds || [];
  const $ = id => document.getElementById(id);
  const selected = new Set();
  let tree = [];
  let rows = [];
  let categories = [];
  let categoryOrder = live ? [] : seed.categoryOrder;
  let source = 'all';
  let sourceSection = null;
  let sourceSectionsExpanded = false;
  let target = { category: '', section: '' };
  let query = '';
  let busy = false;
  let refreshPending = false;
  let dragIds = [];
  let pointerDrag = null;
  let refreshTimer;
  let toastTimer;
  let editing = null;
  let nameTask = null;
  let folderRename = null;
  let prefixEditing = false;
  let deletion = null;
  let importData = null;
  let mergeRequest = null;
  let duplicatePreview = [];
  let managerEdit = null;
  let managerMenu = null;
  let managerMerge = null;
  let managerPointer = null;
  const expandedCategories = new Set([seed.categoryOrder[0]]);
  const renameForm = $('folder-rename-form');
  const editDrafts = new Map();

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(button, name) {
    const paths = { pencil: 'M11.5 3.5 14.5 6.5M3 13l1-4L12 1l3 3-8 8-4 1Z', check: 'm3 8 3 3 7-7', close: 'm4 4 8 8M12 4l-8 8', trash: 'M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4M9 7v4', folder: 'M1.5 4h5l1.5 2h6.5v7h-13V4Z', library: 'M3 2v12M7 2v12M11 2l3 11.5', arrow: 'M4 12 12 4M4 4h8v8', plus: 'M8 3v10M3 8h10', more: 'M3 7v2M8 7v2M13 7v2', chevron: 'm6 4 4 4-4 4', grip: 'M5 3h1M10 3h1M5 8h1M10 8h1M5 13h1M10 13h1' };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[name]);
    svg.append(path);
    button.append(svg);
    return button;
  }

  function targetLabel(value) {
    return [value.category, value.section].filter(Boolean).join(' / ');
  }

  function showNotice(message) {
    $('notice').textContent = message || '';
    $('notice').hidden = !message;
  }

  function toast(message, canUndo = false) {
    clearTimeout(toastTimer);
    $('toast-text').textContent = message;
    $('toast-undo').hidden = !canUndo;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, canUndo ? 11000 : 6500);
  }

  function filteredRows() {
    return rows.filter(row => {
      if (source === 'unfiled' && row.category) return false;
      if (source !== 'all' && source !== 'unfiled' && row.category !== source) return false;
      if (sourceSection !== null && row.sectionRoot !== sourceSection) return false;
      return !query || [row.title, row.url, row.path].join(' ').toLocaleLowerCase().includes(query);
    });
  }

  function renderNavigation() {
    const nav = document.createDocumentFragment();
    const options = [['all', '全部书签', rows.length], ...categories.map(category => [category.title, category.title, category.count])];
    const unfiled = rows.filter(row => !row.category).length;
    if (unfiled) options.push(['unfiled', '未归类', unfiled]);
    for (const [value, title, count] of options) {
      if (value === 'unfiled') nav.append(element('div', 'source-divider'));
      const button = element('button', 'source-button' + (source === value ? ' active' : ''));
      button.type = 'button';
      button.dataset.source = value;
      button.setAttribute('aria-current', source === value ? 'true' : 'false');
      button.append(icon(element('span', 'nav-symbol'), value === 'all' ? 'library' : 'folder'), element('span', 'nav-title', title), element('span', 'nav-count', count));
      nav.append(button);
    }
    $('source-nav').replaceChildren(nav);
    $('source-select').replaceChildren(...options.map(([value, title, count]) => {
      const option = element('option', '', `${title} · ${count}`);
      option.value = value;
      option.selected = value === source;
      return option;
    }));
  }

  function renderList(resetScroll = false) {
    const editor = $('inline-editor');
    const focused = editor?.contains(document.activeElement) ? document.activeElement : null;
    const caret = focused && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    const visible = filteredRows();
    const fragment = document.createDocumentFragment();
    $('source-title').textContent = source === 'all' ? '全部书签' : source === 'unfiled' ? '未归类' : source;
    const scope = sourceSection === null ? '' : `${sourceSection || '直属书签'} · `;
    $('result-count').textContent = scope + (query ? `找到 ${visible.length} 条结果` : `${visible.length} 条书签`);
    if (!visible.length) {
      const empty = element('div', 'list-message');
      let summary = null;
      if (!query && sourceSection !== '' && categories.some(category => category.title === source)) summary = Core.folderSummary(tree, { category: source, section: sourceSection || '' });
      const childFolders = summary ? summary.folders - summary.variants : 0;
      empty.append(element('h3', '', query ? '没有找到匹配书签' : childFolders ? '这个分类包含空文件夹' : '这个分类暂时没有书签'));
      const message = query ? '试试更短的名称、域名或分类。' : childFolders ? '当前范围 0 条书签，包含 ' + childFolders + ' 个空子文件夹。' : '从其他分类选中书签，移动到这里。';
      empty.append(element('p', '', message));
      if (childFolders) {
        empty.append(element('p', 'empty-folder-names', summary.childNames.join('、')));
        const manage = element('button', 'quiet-button', '管理文件夹');
        manage.type = 'button';
        manage.addEventListener('click', () => { expandedCategories.add(source); $('tools-toggle').click(); showTool('categories'); });
        empty.append(manage);
      }
      fragment.append(empty);
    }
    for (const row of visible) {
      const item = element('article', 'bookmark-row' + (selected.has(row.id) ? ' selected' : '') + (editing?.id === row.id ? ' editing' : ''));
      item.dataset.id = row.id;
      item.draggable = false;
      item.setAttribute('role', 'listitem');
      item.title = row.title + '\n' + row.path + '\n' + row.url;
      const handle = element('span', 'drag-handle');
      handle.setAttribute('aria-hidden', 'true');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(row.id);
      checkbox.disabled = busy;
      checkbox.dataset.bookmark = row.id;
      checkbox.setAttribute('aria-label', '选择 ' + row.title);
      const copy = element('div', 'bookmark-copy');
      const title = element('h3', 'bookmark-title');
      const parts = Core.titleParts(row.title);
      if (parts.prefix) title.append(element('span', 'title-prefix', parts.prefix));
      title.append(element('span', 'title-name', parts.name || row.host));
      copy.append(title);
      const meta = element('div', 'bookmark-meta');
      meta.append(element('span', 'bookmark-path', row.path), element('span', 'bookmark-host', row.host));
      if (row.syncing) meta.append(element('span', 'storage-tag', '账号'));
      copy.append(meta);
      item.append(handle, checkbox, copy);
      const edit = element('button', 'text-button edit-bookmark', '编辑');
      edit.type = 'button';
      edit.dataset.edit = row.id;
      edit.disabled = busy;
      edit.setAttribute('aria-label', '编辑 ' + row.title);
      item.append(edit);
      const remove = icon(element('button', 'icon-button danger-icon delete-bookmark'), 'trash');
      remove.type = 'button';
      remove.dataset.delete = row.id;
      remove.disabled = busy;
      remove.setAttribute('aria-label', '删除 ' + row.title);
      remove.title = '删除书签';
      item.append(remove);
      try {
        if (['http:', 'https:', 'file:'].includes(new URL(row.url).protocol)) {
          const link = icon(element('a', 'open-link'), 'arrow');
          link.title = '打开网页';
          link.href = row.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.draggable = false;
          link.setAttribute('aria-label', '打开 ' + row.title);
          item.append(link);
        }
      } catch { /* A saved malformed URL still remains movable. */ }
      if (editing?.id === row.id) item.append(editor || createEditor());
      fragment.append(item);
    }
    const scroll = resetScroll ? 0 : $('bookmark-list').scrollTop;
    $('bookmark-list').replaceChildren(fragment);
    $('bookmark-list').scrollTop = scroll;
    if (focused) { focused.focus({ preventScroll: true }); if (caret) focused.setSelectionRange(...caret); }
    $('bookmark-list').setAttribute('aria-busy', String(busy));
    renderSelection();
  }

  function renderSourceSections() {
    const category = categories.find(category => category.title === source);
    $('rename-category').hidden = !category?.variants.length;
    $('delete-category').hidden = !category?.variants.length;
    document.querySelector('.source-title-row').append(renameForm);
    $('source-filter-panel').hidden = !category?.sections.length;
    const scopeName = sourceSection === null ? source : sourceSection || '直属书签';
    $('search').placeholder = source === 'all' || source === 'unfiled' ? '搜索名称、网址或分类' : `在「${scopeName}」中搜索名称或网址`;
    if (!category?.sections.length) { placeFolderRename(); return; }
    const options = [
      { value: null, label: '全部', count: category.count },
      ...category.sections.map(section => ({ value: section.title, label: section.title, count: section.count }))
    ];
    const direct = rows.filter(row => row.category === source && !row.sectionRoot).length;
    if (direct || sourceSection === '') options.push({ value: '', label: '直属书签', count: direct });
    const fragment = document.createDocumentFragment();
    for (const option of options) {
      const button = element('button', 'source-section' + (sourceSection === option.value ? ' active' : ''));
      button.type = 'button';
      button.dataset.section = option.value || '';
      button.dataset.scope = option.value === null ? 'all' : 'folder';
      button.setAttribute('aria-pressed', String(sourceSection === option.value));
      button.append(element('span', '', option.label), element('small', '', option.count));
      const wrapper = element('div', 'source-section-item' + (sourceSection === option.value ? ' active' : ''));
      wrapper.append(button);
      if (sourceSection === option.value && option.value) {
        for (const [action, name, label] of [['rename', 'pencil', '重命名二级分类'], ['delete', 'trash', '删除二级分类']]) {
          const control = icon(element('button', 'icon-button' + (action === 'delete' ? ' danger-icon' : '')), name);
          control.type = 'button';
          control.dataset.sectionAction = action;
          control.setAttribute('aria-label', label);
          control.title = label;
          control.disabled = busy;
          wrapper.append(control);
        }
      }
      fragment.append(wrapper);
    }
    $('source-sections').replaceChildren(fragment);
    placeFolderRename();
    updateSectionExpansion();
  }

  function updateSectionExpansion() {
    $('source-sections').classList.toggle('collapsed', !sourceSectionsExpanded);
    $('toggle-source-sections').hidden = $('source-sections').scrollHeight <= 72;
    $('toggle-source-sections').textContent = sourceSectionsExpanded ? '收起分类' : '展开全部分类';
    $('toggle-source-sections').setAttribute('aria-expanded', String(sourceSectionsExpanded));
    const active = $('source-sections').querySelector('.active');
    $('source-sections').scrollTop = sourceSectionsExpanded || !active ? 0 : Math.max(0, active.offsetTop - 38);
  }

  function renderSelection() {
    const visible = filteredRows();
    const chosen = visible.filter(row => selected.has(row.id)).length;
    $('select-all').checked = visible.length > 0 && chosen === visible.length;
    $('select-all').indeterminate = chosen > 0 && chosen < visible.length;
    $('select-all').disabled = busy || visible.length === 0;
    $('clear-selection').hidden = selected.size === 0;
    if (!selected.size) prefixEditing = false;
    $('prefix-form').hidden = !selected.size || !prefixEditing;
    $('open-prefix').hidden = !selected.size || prefixEditing;
    $('delete-selected').hidden = !selected.size;
    $('bulk-prefix').disabled = busy;
    $('apply-prefix').disabled = busy;
    $('select-label').textContent = selected.size ? `已选择 ${selected.size} 条` : '全选当前结果';
    $('selection-summary').textContent = selected.size ? `已选 ${selected.size} 条，可批量拖动或点击右侧移动` : '可同时选中多条移动';
    $('move-selected').disabled = busy || selected.size === 0 || !target.category;
    $('move-selected').textContent = busy ? '正在移动…' : !target.category ? '先新建目标分类' : selected.size ? `移动 ${selected.size} 条到这里` : '先选择书签';
    $('target-path').textContent = '目标 · ' + targetLabel(target);
    $('undo').disabled = busy || adapter.history.length === 0;
    $('refresh').disabled = busy;
    $('export').disabled = busy;
    $('tools-toggle').disabled = busy;
    $('connect').disabled = busy;
    for (const control of $('library-tools').querySelectorAll('input, select, button')) control.disabled = busy || control.dataset.unavailable === 'true';
    $('confirm-import').disabled = busy || !importData;
    for (const id of ['rename-category', 'delete-category', 'folder-name', 'save-folder-name', 'cancel-folder-name', 'open-prefix', 'cancel-prefix', 'delete-selected']) $(id).disabled = busy;
    for (const button of document.querySelectorAll('[data-section-action]')) button.disabled = busy;
    for (const destination of document.querySelectorAll('.drop-target')) destination.disabled = busy;
    for (const row of $('bookmark-list').querySelectorAll('.bookmark-row')) {
      const checked = selected.has(row.dataset.id);
      row.classList.toggle('selected', checked);
      row.querySelector('input').checked = checked;
      row.querySelector('input').disabled = busy;
      row.querySelector('.edit-bookmark').disabled = busy;
      row.querySelector('.delete-bookmark').disabled = busy;
      row.draggable = false;
    }
  }

  function renderTargets() {
    const fragment = document.createDocumentFragment();
    for (const category of categories) {
      const button = element('button', 'category-target drop-target' + (category.title === target.category ? ' active' : ''));
      button.type = 'button';
      button.dataset.category = category.title;
      button.dataset.section = '';
      button.setAttribute('aria-label', '目标分类 ' + category.title);
      button.setAttribute('aria-pressed', String(category.title === target.category && !target.section));
      button.append(element('span', '', category.title), element('small', '', category.count));
      fragment.append(button);
    }
    $('category-targets').replaceChildren(fragment);
    renderFolders();
  }

  function renderFolders() {
    const category = categories.find(category => category.title === target.category);
    const sections = category?.sections || [];
    $('folder-title').textContent = target.category + ' · 二级文件夹';
    $('folder-count').textContent = sections.length;
    const fragment = document.createDocumentFragment();
    for (const section of sections) {
      const button = element('button', 'folder-target drop-target' + (section.title === target.section ? ' active' : ''));
      button.type = 'button';
      button.dataset.category = target.category;
      button.dataset.section = section.title;
      button.setAttribute('aria-label', '目标文件夹 ' + section.title);
      button.setAttribute('aria-pressed', String(section.title === target.section));
      button.append(element('span', '', section.title), element('small', '', section.count));
      fragment.append(button);
    }
    if (!sections.length) fragment.append(element('p', 'sidebar-note', '可直接移入上方一级分类。'));
    $('folder-targets').replaceChildren(fragment);
    renderSelection();
  }

  function renderStatus() {
    $('mode').textContent = live ? 'Chrome 书签' : '示例预览';
    $('mode').classList.toggle('live', live);
    $('connect').hidden = live;
    $('refresh').textContent = '刷新';
    $('save-status').textContent = busy ? '正在处理…' : live ? '更改立即写入浏览器，可撤销' : adapter.updatedAt ? '更改已保存到本机' : '公开示例 · 可直接体验';
    $('total-count').textContent = `共 ${rows.length} 条`;
    $('sidebar-note').textContent = live ? '更改写入当前 Chrome 书签。账号书签由浏览器同步。' : '当前使用公开示例。通过 Chrome 扩展打开自己的书签。';
  }

  async function refresh(resetScroll = false) {
    tree = await adapter.load();
    categoryOrder = Core.categoryNames(tree);
    rows = Core.bookmarks(tree).map(item => Core.describe(item, categoryOrder));
    categories = Core.catalog(tree, categoryOrder, ignoredFolderIds);
    const existing = new Set(rows.map(row => row.id));
    for (const id of selected) if (!existing.has(id)) selected.delete(id);
    if (source === 'unfiled' && !rows.some(row => !row.category)) source = 'all';
    if (source !== 'all' && source !== 'unfiled' && !categories.some(category => category.title === source)) source = 'all';
    if (!categories.some(category => category.title === target.category)) target = { category: categories[0]?.title || '', section: '' };
    const currentCategory = categories.find(category => category.title === source);
    if (sourceSection && !currentCategory?.sections.some(section => section.title === sourceSection)) sourceSection = null;
    renderNavigation();
    renderSourceSections();
    renderList(resetScroll);
    renderTargets();
    renderStatus();
    renderTools();
  }

  async function move(ids, destination, link) {
    if (busy) return;
    busy = true;
    showNotice('');
    renderSelection();
    renderStatus();
    try {
      const result = await adapter.move(ids, destination, link);
      selected.clear();
      target = { ...destination };
      await refresh();
      if (result.count) closeTargets(true);
      if (result.error) showNotice(`${result.count} 条已完成。${result.error}`);
      else toast(result.count ? `已将 ${result.count} 条书签移到「${targetLabel(destination)}」` : '这些书签已经在目标分类中。', result.count > 0);
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) {
      showNotice(failure.message || '移动失败，请刷新后重试。');
      await refresh().catch(() => {});
    } finally {
      busy = false;
      renderSelection();
      renderStatus();
      if (refreshPending) { refreshPending = false; scheduleRefresh(); }
    }
  }

  async function undo() {
    if (busy || !adapter.history.length) return;
    busy = true;
    renderSelection();
    renderStatus();
    try {
      const result = await adapter.undo();
      if (result.rename) applyFolderRename(result.rename);
      await refresh();
      if (result.error) showNotice(result.error);
      toast(`已撤销 ${result.count} 条更改` + (result.skipped ? `，另有 ${result.skipped} 条因内容或位置已变化而跳过。` : '。'));
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) {
      showNotice('撤销未完成。' + failure.message);
    } finally {
      busy = false;
      renderSelection();
      renderStatus();
    }
  }

  function scheduleRefresh() {
    if (busy) { refreshPending = true; return; }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refresh().catch(failure => showNotice('读取 Chrome 书签失败。' + failure.message)); }, 180);
  }

  function editMessage(message, error = false) {
    if (!$('edit-message')) return;
    $('edit-message').textContent = message;
    $('edit-message').hidden = !message;
    $('edit-message').classList.toggle('error', error);
  }

  function createEditor() {
    const form = element('form', 'inline-editor');
    form.id = 'inline-editor';
    form.setAttribute('aria-label', '编辑书签');
    const fields = element('div', 'inline-fields');
    for (const [key, label, value] of [['prefix', '前缀', editing.prefix], ['name', '名称', editing.name], ['url', '网址', editing.url]]) {
      const field = element('label', 'inline-field field-' + key, label);
      const input = element('input');
      input.id = 'edit-' + key;
      input.name = key;
      input.value = value;
      input.autocomplete = 'off';
      input.required = key !== 'prefix';
      input.disabled = busy || Boolean(nameTask);
      if (key === 'prefix') { input.setAttribute('list', 'prefix-options'); input.placeholder = '可留空'; }
      if (key === 'url') input.spellcheck = false;
      field.append(input);
      fields.append(field);
    }
    const actions = element('div', 'inline-actions');
    const read = element('button', 'quiet-button', '读取网页标题');
    read.id = 'read-page-title';
    read.type = 'button';
    read.disabled = busy || Boolean(nameTask);
    const hint = element('span', 'inline-hint', live ? '保存后同步，可撤销' : '保存到草稿，可撤销');
    const cancel = element('button', 'text-button', '取消');
    cancel.type = 'button';
    cancel.id = 'cancel-edit';
    cancel.disabled = busy;
    const save = element('button', 'primary-button', '保存');
    save.id = 'save-edit';
    save.type = 'submit';
    save.disabled = busy || Boolean(nameTask);
    const message = element('p', 'edit-message');
    message.id = 'edit-message';
    message.setAttribute('role', 'status');
    message.hidden = true;
    actions.append(read, hint, cancel, save);
    form.append(fields, actions, message);
    return form;
  }

  function openEditor(id) {
    if (busy) return;
    const row = rows.find(row => row.id === id);
    if (!row) return;
    if (editing?.id === id) { $('edit-name')?.focus(); return; }
    nameTask?.abort();
    nameTask = null;
    $('inline-editor')?.remove();
    if (!editDrafts.has(id)) editDrafts.set(id, { id, ...Core.titleParts(row.title), url: row.url, expected: { title: row.title, url: row.url } });
    editing = editDrafts.get(id);
    renderList();
    $('edit-name')?.focus();
    $('edit-name')?.select();
  }

  function cancelEditor() {
    if (busy) return;
    nameTask?.abort();
    nameTask = null;
    if (editing) editDrafts.delete(editing.id);
    editing = null;
    renderList();
  }

  function setReadControls(active) {
    for (const id of ['edit-prefix', 'edit-name', 'edit-url', 'read-page-title', 'save-edit']) if ($(id)) $(id).disabled = active;
  }

  async function readPageTitle() {
    if (nameTask || !editing) return;
    const draft = editing;
    const controller = new AbortController();
    nameTask = controller;
    setReadControls(true);
    editMessage('正在读取网页标题…首次访问需要允许该站点的读取权限。');
    const timeout = setTimeout(() => controller.abort(new Error('网页读取超时，请重试。')), 25000);
    try {
      const url = await window.BookmarkPageTools.requestSite(draft.url.trim());
      const info = await window.BookmarkPageTools.readPage(url, controller.signal);
      controller.signal.throwIfAborted();
      if (editing !== draft) return;
      draft.name = info.title;
      if ($('edit-name')) $('edit-name').value = info.title;
      editMessage('已填入网页原标题，可直接调整后保存。');
    } catch (failure) {
      let message = failure.message || '网页读取失败，可直接手动编辑名称。';
      if (controller.signal.aborted) message = controller.signal.reason?.message === '网页读取超时，请重试。' ? controller.signal.reason.message : '已取消网页读取。';
      if (editing === draft) editMessage(message, !controller.signal.aborted);
    } finally {
      clearTimeout(timeout);
      if (nameTask === controller) { nameTask = null; setReadControls(false); }
    }
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (!editing || busy || nameTask) return;
    const draft = editing;
    busy = true;
    setReadControls(true);
    $('cancel-edit').disabled = true;
    renderSelection();
    try {
      const title = Core.prefixedTitle(draft.prefix, draft.name);
      const result = await adapter.update(draft.id, { title, url: draft.url }, draft.expected);
      editDrafts.delete(draft.id);
      editing = null;
      await refresh();
      toast(result.count ? '书签名称和网址已保存。' : '名称和网址没有变化。', result.count > 0);
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) {
      if (editing) editMessage(failure.message || '保存失败，请重试。', true);
      else showNotice('书签已保存，列表刷新失败，请点击刷新。');
    } finally {
      busy = false;
      setReadControls(false);
      if ($('cancel-edit')) $('cancel-edit').disabled = false;
      renderSelection();
      renderStatus();
      if (refreshPending) { refreshPending = false; scheduleRefresh(); }
    }
  }

  async function applyPrefix(event) {
    event.preventDefault();
    if (busy || !selected.size) return;
    if (editing && selected.has(editing.id)) { editMessage('请先保存或取消这条书签的编辑，再应用统一前缀。', true); return; }
    busy = true;
    renderSelection();
    try {
      const result = await adapter.setPrefix([...selected], $('bulk-prefix').value);
      prefixEditing = false;
      await refresh();
      if (result.error) showNotice(`${result.count} 条已完成。${result.error}`);
      else toast(result.count ? `已为 ${result.count} 条书签设置统一前缀。` : '所选书签已经使用这个前缀。', result.count > 0);
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) { showNotice(failure.message || '前缀更新失败，请重试。'); }
    finally { busy = false; renderSelection(); renderStatus(); if (refreshPending) { refreshPending = false; scheduleRefresh(); } }
  }

  function selectTarget(destination) {
    target = { category: destination.dataset.category, section: destination.dataset.section };
    for (const root of $('category-targets').children) {
      root.classList.toggle('active', root.dataset.category === target.category);
      root.setAttribute('aria-pressed', String(root.dataset.category === target.category && !target.section));
    }
    renderFolders();
  }

  function expandDragCategory(destination) {
    if (!destination?.classList.contains('category-target')) return;
    if (target.category === destination.dataset.category && !target.section) return;
    selectTarget(destination);
  }

  function selectSource(value) {
    closeTools();
    $('connect-panel').hidden = true; document.querySelector('.bookmark-pane').classList.remove('connecting');
    cancelFolderRename();
    source = value;
    sourceSection = null;
    sourceSectionsExpanded = false;
    renderNavigation();
    renderSourceSections();
    renderList(true);
  }

  function cancelFolderRename() {
    if (busy) return;
    folderRename = null;
    placeFolderRename();
  }

  function placeFolderRename() {
    const section = Boolean(folderRename?.section);
    const wrapper = section ? $('source-sections').querySelector('.source-section-item.active') : document.querySelector('.source-title-row');
    const rootEditing = Boolean(folderRename && !section);
    $('source-title').hidden = rootEditing;
    $('rename-category').hidden = rootEditing || !categories.some(category => category.title === source && category.variants.length);
    $('delete-category').hidden = rootEditing || !categories.some(category => category.title === source && category.variants.length);
    for (const item of $('source-sections').children) {
      for (const child of item.children) if (child !== renameForm) child.hidden = Boolean(folderRename && section && item === wrapper);
    }
    if (wrapper) wrapper.append(renameForm);
    renameForm.hidden = !folderRename;
  }

  function openFolderRename(section) {
    if (busy) return;
    folderRename = { category: source, section: section ? sourceSection : '' };
    const category = categories.find(category => category.title === source);
    const variants = section ? category.variants.flatMap(folder => folder.children || []).filter(folder => !folder.url && folder.title === sourceSection) : category.variants;
    $('folder-name-label').textContent = section ? '二级分类名称' : '一级分类名称';
    $('folder-name').value = section ? sourceSection : source;
    $('folder-rename-note').textContent = variants.length > 1 ? `${variants.length} 处` : '';
    $('folder-rename-note').title = `${variants.length} 个同名文件夹会一起改名`;
    $('folder-rename-note').hidden = variants.length <= 1;
    $('folder-rename-message').hidden = true;
    placeFolderRename();
    $('folder-name').focus();
    $('folder-name').select();
  }

  function applyFolderRename(rename) {
    if (rename.section) {
      if (source === rename.category && sourceSection === rename.before) sourceSection = rename.after;
      if (target.category === rename.category && target.section === rename.before) target.section = rename.after;
      return;
    }
    if (expandedCategories.delete(rename.before)) expandedCategories.add(rename.after);
    if (source === rename.before) source = rename.after;
    if (target.category === rename.before) target.category = rename.after;
  }

  async function saveFolderRename(event) {
    event.preventDefault();
    if (busy || !folderRename) return;
    busy = true;
    showNotice('');
    $('folder-rename-message').hidden = true;
    renderSelection();
    try {
      const result = await adapter.renameFolders(folderRename, $('folder-name').value);
      if (result.count) applyFolderRename(result.rename);
      await refresh();
      if (result.error) {
        showNotice(`已改名 ${result.count} 个文件夹。${result.error}`);
        $('folder-rename-message').textContent = result.error;
        $('folder-rename-message').hidden = false;
      } else {
        folderRename = null;
        placeFolderRename();
        toast(result.count ? `分类已改名为「${result.rename.after}」。` : '分类名称没有变化。', result.count > 0);
      }
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) {
      $('folder-rename-message').textContent = failure.message || '分类改名失败，请刷新后重试。';
      $('folder-rename-message').hidden = false;
    } finally {
      busy = false;
      renderSelection();
      renderStatus();
      if (refreshPending) { refreshPending = false; scheduleRefresh(); }
    }
  }

  function openDelete(ids, label, keepers = []) {
    if (busy) return;
    try {
      const plan = Core.deletionPlan(tree, ids);
      if (!plan.nodes.length) return;
      deletion = { ids, signature: Core.deletionSignature(plan), keepers };
      $('delete-title').textContent = label ? `删除「${label}」？` : `删除 ${plan.bookmarks} 条书签？`;
      $('delete-description').textContent = plan.bookmarks ? '将删除 ' + plan.bookmarks + ' 条书签' + (plan.folders ? '及 ' + plan.folders + ' 个文件夹，范围包含所选目录及下级目录。' : '。') : '将删除 ' + plan.folders + ' 个空文件夹，范围包含所选目录及下级目录。';
      $('delete-folders').hidden = !plan.folders;
      $('delete-folders').replaceChildren(...[...plan.nodes].reverse().filter(node => !node.url).slice(0, 20).map(node => element('li', '', node.title)));
      if (plan.folders > 20) $('delete-folders').append(element('li', '', '另有 ' + (plan.folders - 20) + ' 个文件夹'));
      $('delete-note').textContent = (plan.bookmarks ? '' : '范围内共 0 条书签。') + (live ? '确认后同步到 Chrome。' : '确认后更新本地草稿。') + '可通过撤销恢复内容与位置。' + (live ? '恢复后创建时间会更新。' : '');
      $('delete-message').hidden = true;
      $('delete-dialog').showModal();
    } catch (failure) { showNotice(failure.message); }
  }

  function deleteFolder(section) {
    try { openDelete(Core.folderDeletionIds(tree, { category: source, section: section ? sourceSection : '' }), section ? sourceSection : source); }
    catch (failure) { showNotice(failure.message); }
  }

  async function confirmDelete() {
    if (busy || !deletion) return;
    cancelEditor();
    busy = true;
    $('confirm-delete').disabled = true;
    $('cancel-delete').disabled = true;
    renderSelection();
    renderStatus();
    try {
      const result = await adapter.remove(deletion.ids, deletion.signature, deletion.keepers);
      $('delete-dialog').close();
      deletion = null;
      folderRename = null;
      await refresh();
      if (result.error) showNotice(`已删除 ${result.count} 项，可撤销。${result.error}`);
      toast(`已删除 ${result.count} 项。`, result.count > 0);
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) {
      $('delete-message').textContent = failure.message;
      $('delete-message').hidden = false;
    } finally {
      busy = false;
      $('confirm-delete').disabled = false;
      $('cancel-delete').disabled = false;
      renderSelection();
      renderStatus();
      if (refreshPending) { refreshPending = false; scheduleRefresh(); }
    }
  }

  function clearDrag() {
    if (pointerDrag?.row.hasPointerCapture(pointerDrag.pointerId)) pointerDrag.row.releasePointerCapture(pointerDrag.pointerId);
    pointerDrag = null;
    dragIds = [];
    $('drag-count').hidden = true;
    document.body.classList.remove('is-dragging');
    for (const row of document.querySelectorAll('.dragging, .drag-over')) row.classList.remove('dragging', 'drag-over');
  }


  function toolsMessage(message) {
    $('tools-message').textContent = message;
    $('tools-message').hidden = !message;
  }

  function setOptions(select, options) {
    const value = select.value;
    select.replaceChildren(...options.map(([value, label]) => {
      const option = element('option', '', label);
      option.value = value;
      return option;
    }));
    if (options.some(option => option[0] === value)) select.value = value;
  }

  function folderChoices() {
    return categories.flatMap(category => [
      [{ category: category.title, section: '' }, category.title],
      ...category.sections.map(section => [{ category: category.title, section: section.title }, category.title + ' / ' + section.title])
    ]);
  }

  function managerButton(label, symbol, action, scope) {
    const button = element('button', symbol ? 'icon-button manager-action' : 'text-button');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.dataset.managerAction = action;
    button.dataset.scope = JSON.stringify(scope);
    if (symbol) icon(button, symbol);
    else button.textContent = label;
    return button;
  }

  function managerEditor() {
    const form = element('form', 'manager-editor');
    form.id = 'manager-editor';
    const input = element('input');
    input.id = 'manager-name'; input.name = 'title'; input.required = true;
    input.autocomplete = 'off'; input.maxLength = 150; input.value = managerEdit.title;
    input.placeholder = managerEdit.kind === 'rename' ? '分类名称' : '新分类名称';
    input.setAttribute('aria-label', managerEdit.kind === 'rename' ? '修改分类名称' : '新分类名称');
    if (managerEdit.kind === 'create') {
      const roots = managerEdit.category ? categories.find(item => item.title === managerEdit.category)?.variants || [] : Core.editableRoots(tree);
      if (roots.length > 1) {
        const select = element('select'); select.name = 'parentId'; select.setAttribute('aria-label', '创建位置');
        for (const root of roots) {
          const option = element('option', '', root.title + (root.syncing ? ' · 账号' : ' · 本机'));
          option.value = root.id; select.append(option);
        }
        select.value = managerEdit.parentId; form.append(select);
      }
    }
    form.append(input);
    const save = icon(element('button', 'icon-button save-icon'), 'check');
    save.type = 'submit'; save.setAttribute('aria-label', '保存分类'); save.title = '保存 · Enter';
    const cancel = managerButton('取消编辑分类', 'close', 'cancel-edit', {});
    form.append(save, cancel);
    return form;
  }

  function renderManager() {
    const focused = $('manager-editor')?.contains(document.activeElement) ? document.activeElement : null;
    const caret = focused?.id === 'manager-name' ? [focused.selectionStart, focused.selectionEnd] : null;
    const fragment = document.createDocumentFragment();
    if (managerEdit?.kind === 'create' && !managerEdit.category) fragment.append(managerEditor());
    const list = element('ul', 'manager-list');
    function row(scope, count, hasChildren, nestedFolders = 0) {
      const wrapper = element('li', scope.section ? 'manager-item manager-child' : 'manager-item');
      const line = element('div', 'manager-row'); line.dataset.scope = JSON.stringify(scope);
      line.append(icon(element('span', 'manager-grip'), 'grip'));
      if (!scope.section) {
        const expand = managerButton((expandedCategories.has(scope.category) ? '收起 ' : '展开 ') + scope.category, 'chevron', 'expand', scope);
        expand.classList.add('manager-expand'); expand.setAttribute('aria-expanded', String(expandedCategories.has(scope.category)));
        line.append(expand);
      } else line.append(element('span', 'manager-indent'));
      line.append(icon(element('span', 'manager-folder'), 'folder'));
      const editing = managerEdit?.kind === 'rename' && JSON.stringify(managerEdit.scope) === JSON.stringify(scope);
      if (editing) line.append(managerEditor());
      else {
        const name = element('span', 'manager-name', scope.section || scope.category);
        if (!count && nestedFolders) name.append(element('small', 'manager-depth-note', '含 ' + nestedFolders + ' 个空子目录'));
        line.append(name, element('span', 'manager-count', count));
        if (!scope.section) line.append(managerButton('添加二级分类 ' + scope.category, 'plus', 'create-child', scope));
        line.append(managerButton('改名 ' + targetLabel(scope), 'pencil', 'rename', scope), managerButton('更多 ' + targetLabel(scope), 'more', 'menu', scope));
      }
      wrapper.append(line);
      if (managerMenu === JSON.stringify(scope)) {
        const actions = element('div', 'manager-row-menu');
        for (const [action, label, direction] of [['up', '上移', -1], ['down', '下移', 1]]) {
          const button = managerButton(label, null, action, scope);
          try { button.dataset.unavailable = String(!Core.structurePlan(tree, { kind: 'order', target: scope, direction }).steps.length); }
          catch { button.dataset.unavailable = 'true'; }
          button.disabled = busy || button.dataset.unavailable === 'true'; actions.append(button);
        }
        actions.append(managerButton('合并到…', null, 'merge', scope));
        const remove = managerButton('删除分类', null, 'delete', scope); remove.classList.add('danger-text'); actions.append(remove);
        wrapper.append(actions);
      }
      if (managerMerge && JSON.stringify(managerMerge) === JSON.stringify(scope)) {
        const picker = element('div', 'manager-merge-picker');
        const heading = element('div', 'manager-picker-heading');
        heading.append(element('span', '', '选择要合并到的分类'), managerButton('取消合并', null, 'cancel-merge', scope)); picker.append(heading);
        const targets = folderChoices().filter(([item]) => Boolean(item.section) === Boolean(scope.section) && JSON.stringify(item) !== JSON.stringify(scope));
        for (const [item, label] of targets) picker.append(managerButton(label, null, 'merge-target', item));
        if (!targets.length) picker.append(element('p', 'tool-note', '还没有其他同级分类。'));
        wrapper.append(picker);
      }
      if (!scope.section && expandedCategories.has(scope.category)) {
        const children = element('ul', 'manager-children');
        for (const child of hasChildren) children.append(row({ category: scope.category, section: child.title }, child.count, [], child.folderCount));
        if (managerEdit?.kind === 'create' && managerEdit.category === scope.category) {
          const child = element('li', 'manager-new-child'); child.append(managerEditor()); children.append(child);
        }
        if (children.children.length) wrapper.append(children);
      }
      return wrapper;
    }
    for (const category of categories.filter(item => item.variants.length)) list.append(row({ category: category.title, section: '' }, category.count, category.sections));
    fragment.append(list);
    if (!list.children.length && !managerEdit) fragment.append(element('p', 'tool-note', '还没有分类，点击“新建分类”开始。'));
    $('category-manager').replaceChildren(fragment);
    for (const control of $('category-manager').querySelectorAll('button,input,select')) control.disabled = busy || control.dataset.unavailable === 'true';
    if (focused && $('manager-name')) { $('manager-name').focus({ preventScroll: true }); if (caret) $('manager-name').setSelectionRange(...caret); }
  }

  function beginManagerEdit(value) {
    managerEdit = value; managerMenu = null; managerMerge = null; toolsMessage('');
    renderManager(); $('manager-name').focus(); $('manager-name').select();
  }

  function openMergePreview(from, to) {
    try {
      const plan = Core.deletionPlan(tree, Core.folderDeletionIds(tree, from));
      mergeRequest = { kind: 'merge', source: from, target: to, signature: Core.deletionSignature(plan) };
      Core.structurePlan(tree, mergeRequest);
      $('merge-description').textContent = `将「${targetLabel(from)}」中的 ${plan.bookmarks} 条书签合并到「${targetLabel(to)}」。`;
      $('merge-dialog').showModal();
    } catch (failure) { toolsMessage(failure.message); }
  }

  function renderDuplicates() {
    const groups = Core.duplicateGroups(tree);
    duplicatePreview = groups.slice(0, 100);
    const fragment = document.createDocumentFragment();
    if (!groups.length) fragment.append(element('p', 'tool-note', '没有找到相同网址的重复书签。'));
    if (groups.length > 100) fragment.append(element('p', 'tool-note', `共 ${groups.length} 组，本次显示前 100 组。处理后可继续查重。`));
    duplicatePreview.forEach((group, index) => {
      const fieldset = element('fieldset', 'duplicate-group');
      fieldset.append(element('legend', '', group[0].url));
      for (const [position, row] of group.entries()) {
        const label = element('label', 'duplicate-choice');
        const radio = element('input');
        radio.type = 'radio'; radio.name = 'duplicate-' + index; radio.value = row.id; radio.checked = position === 0;
        radio.setAttribute('aria-label', '保留 ' + row.title + '，' + row.path);
        const text = element('span', '', row.title);
        text.append(element('small', '', row.path + (row.syncing ? ' · 账号' : ' · 本机')));
        label.append(radio, text); fieldset.append(label);
      }
      fragment.append(fieldset);
    });
    $('duplicate-results').replaceChildren(fragment);
    $('remove-duplicates').hidden = !groups.length;
  }

  function renderImportPreview() {
    $('import-preview').hidden = !importData;
    if (!importData) return;
    try {
      const plan = Core.structurePlan(tree, { kind: 'import', parentId: $('import-parent').value, forest: importData.forest });
      $('import-summary').textContent = `${importData.name} · 将导入 ${plan.imported} 条，跳过 ${plan.skipped} 条相同网址` + (importData.skipped ? `、${importData.skipped} 条无效网址` : '') + (importData.flattened ? `。${importData.flattened} 个深层文件夹折叠到二级路径` : '');
      $('import-categories').replaceChildren(...importData.forest.filter(node => !node.url).map(node => element('li', '', node.title + ' · ' + Core.count(node) + ' 条')));
    } catch (failure) { toolsMessage(failure.message); }
  }

  function renderTools() {
    const roots = Core.editableRoots(tree);
    const rootOptions = roots.map(root => [root.id, root.title + (root.syncing ? ' · 账号' : ' · 本机')]);
    setOptions($('import-parent'), rootOptions);
    renderManager();
    $('confirm-import').disabled = busy || !importData;
    if (!$('tool-duplicates').hidden) renderDuplicates();
    renderImportPreview();
  }

  async function organize(request, message, action) {
    if (busy) return;
    busy = true; toolsMessage('正在处理…'); renderSelection(); renderStatus();
    try {
      const result = await (action ? action() : adapter.organize(request));
      await refresh();
      if (result.error) { showNotice(result.error); toolsMessage(result.error); }
      else { toolsMessage(message); toast(message, result.count > 0); }
      if (adapter.warning) showNotice(adapter.warning);
      return !result.error;
    } catch (failure) { toolsMessage(failure.message); await refresh().catch(() => {}); return false; }
    finally { busy = false; renderSelection(); renderStatus(); if (refreshPending) { refreshPending = false; scheduleRefresh(); } }
  }

  function parseBookmarkHtml(text) {
    const document = new DOMParser().parseFromString(text, 'text/html');
    const root = document.querySelector('dl');
    if (!root) throw new Error('文件中没有找到书签目录，请选择浏览器导出的 HTML。');
    function parse(dl, depth) {
      if (depth > 30) throw new Error('文件夹层级过深，请检查导入文件。');
      const nodes = [];
      for (const item of dl.children) {
        if (item.tagName !== 'DT') continue;
        const link = item.querySelector(':scope > a');
        const heading = item.querySelector(':scope > h3');
        if (link) nodes.push({ title: link.textContent, url: link.getAttribute('href') });
        else if (heading) {
          const children = item.querySelector(':scope > dl') || (item.nextElementSibling?.tagName === 'DL' ? item.nextElementSibling : null);
          const folder = { title: heading.textContent, children: children ? parse(children, depth + 1) : [] };
          if (heading.hasAttribute('data-bookmark-root') || heading.getAttribute('personal_toolbar_folder') === 'true') folder.folderType = 'import-root';
          nodes.push(folder);
        }
      }
      return nodes;
    }
    return parse(root, 0);
  }

  function showTool(name) {
    for (const tab of $('library-tools').querySelectorAll('[role="tab"]')) {
      const active = tab.id === 'tab-' + name;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = !active;
    }
    toolsMessage(''); renderTools();
  }

  $('tools-toggle').addEventListener('click', () => {
    const open = $('library-tools').hidden;
    $('library-tools').hidden = !open;
    $('tools-toggle').setAttribute('aria-expanded', String(open));
    document.querySelector('.bookmark-pane').classList.toggle('tools-open', open);
    document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', open ? 'tools-title' : 'source-title');
    $('connect-panel').hidden = true; document.querySelector('.bookmark-pane').classList.remove('connecting');
    if (open) { renderTools(); $('library-tools').querySelector('[aria-selected="true"]').focus(); }
  });
  $('tools-close').addEventListener('click', () => { closeTools(); $('tools-toggle').focus(); });
  for (const name of ['categories', 'duplicates', 'import']) $('tab-' + name).addEventListener('click', () => showTool(name));
  $('library-tools').querySelector('[role="tablist"]').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...event.currentTarget.children];
    let index = tabs.indexOf(document.activeElement);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else index = (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[index].click(); tabs[index].focus();
  });
  function closeTools() {
    $('library-tools').hidden = true;
    $('tools-toggle').setAttribute('aria-expanded', 'false');
    document.querySelector('.bookmark-pane').classList.remove('tools-open');
    document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', 'source-title');
  }

  $('create-category').addEventListener('click', () => {
    const root = Core.editableRoots(tree)[0];
    if (root) beginManagerEdit({ kind: 'create', category: '', parentId: root.id, title: '' });
  });
  $('category-manager').addEventListener('click', event => {
    const button = event.target.closest('[data-manager-action]');
    if (!button || busy) return;
    const scope = JSON.parse(button.dataset.scope);
    const action = button.dataset.managerAction;
    if (action === 'expand') {
      if (expandedCategories.has(scope.category)) expandedCategories.delete(scope.category);
      else expandedCategories.add(scope.category);
    } else if (action === 'create-child') {
      const category = categories.find(item => item.title === scope.category);
      expandedCategories.add(scope.category);
      beginManagerEdit({ kind: 'create', category: scope.category, parentId: category.variants[0].id, title: '' }); return;
    } else if (action === 'rename') { beginManagerEdit({ kind: 'rename', scope, title: scope.section || scope.category }); return; }
    else if (action === 'cancel-edit') managerEdit = null;
    else if (action === 'menu') { managerMenu = managerMenu === JSON.stringify(scope) ? null : JSON.stringify(scope); managerMerge = null; }
    else if (action === 'merge') { managerMerge = scope; managerMenu = null; }
    else if (action === 'cancel-merge') managerMerge = null;
    else if (action === 'merge-target') { openMergePreview(managerMerge, scope); return; }
    else if (action === 'delete') { openDelete(Core.folderDeletionIds(tree, scope), targetLabel(scope)); return; }
    else if (action === 'up' || action === 'down') { organize({ kind: 'order', target: scope, direction: action === 'up' ? -1 : 1 }, '分类顺序已更新。'); return; }
    renderManager();
    const controls = [...$('category-manager').querySelectorAll('[data-manager-action]')];
    let focus = controls.find(item => item.dataset.scope === JSON.stringify(scope) && item.dataset.managerAction === action);
    if (action === 'menu' && managerMenu) focus = $('category-manager').querySelector('.manager-row-menu button:not(:disabled)');
    if (action === 'merge') focus = $('category-manager').querySelector('.manager-merge-picker button');
    if (action === 'cancel-edit') focus = $('create-category');
    focus?.focus({ preventScroll: true });
  });
  $('category-manager').addEventListener('input', event => {
    if (managerEdit && event.target.name === 'title') managerEdit.title = event.target.value;
  });
  $('category-manager').addEventListener('change', event => {
    if (managerEdit && event.target.name === 'parentId') managerEdit.parentId = event.target.value;
  });
  $('category-manager').addEventListener('keydown', event => {
    if (event.key === 'Escape' && managerEdit) { managerEdit = null; renderManager(); $('create-category').focus(); }
  });
  $('category-manager').addEventListener('submit', async event => {
    event.preventDefault();
    if (!managerEdit || busy) return;
    const edit = { ...managerEdit };
    let complete;
    if (edit.kind === 'create') complete = await organize({ kind: 'create', parentId: edit.parentId, title: edit.title }, '分类已新建。');
    else complete = await organize(null, '分类名称已更新。', async () => {
      const result = await adapter.renameFolders(edit.scope, edit.title);
      if (result.count) applyFolderRename(result.rename);
      return result;
    });
    if (complete) { managerEdit = null; renderManager(); $('create-category').focus(); }
    else $('manager-name')?.focus();
  });

  function clearManagerDrag() {
    if (managerPointer?.active) $('drag-count').hidden = true;
    managerPointer = null;
    for (const row of $('category-manager').querySelectorAll('.insert-before,.insert-after,.manager-dragging')) row.classList.remove('insert-before', 'insert-after', 'manager-dragging');
  }
  $('category-manager').addEventListener('pointerdown', event => {
    if (busy || managerEdit || event.button !== 0 || event.target.closest('button,input,select,form')) return;
    const row = event.target.closest('.manager-row');
    if (!row) return;
    event.preventDefault();
    managerPointer = { source: JSON.parse(row.dataset.scope), row, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false, destination: null };
    row.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    const drag = managerPointer;
    if (!drag || event.pointerId !== drag.pointerId || !drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7) return;
    drag.active = true; event.preventDefault(); drag.row.classList.add('manager-dragging');
    for (const row of $('category-manager').querySelectorAll('.insert-before,.insert-after')) row.classList.remove('insert-before','insert-after');
    const row = document.elementFromPoint(event.clientX,event.clientY)?.closest('.manager-row');
    const scope = row ? JSON.parse(row.dataset.scope) : null;
    drag.destination = null;
    if (scope && Boolean(scope.section) === Boolean(drag.source.section) && (!scope.section || scope.category === drag.source.category) && JSON.stringify(scope) !== JSON.stringify(drag.source)) {
      const after = event.clientY > row.getBoundingClientRect().top + row.clientHeight / 2;
      row.classList.add(after ? 'insert-after' : 'insert-before'); drag.destination = { target: scope, after };
    }
    $('drag-count').hidden = false;
    $('drag-count').textContent = drag.destination ? '松手调整分类顺序' : targetLabel(drag.source);
    $('drag-count').style.transform = `translate(${event.clientX + 16}px, ${event.clientY + 14}px)`;
    const panel = $('tool-categories'); const bounds = panel.getBoundingClientRect();
    if (event.clientY > bounds.bottom - 35) panel.scrollTop += 12;
    if (event.clientY < bounds.top + 35) panel.scrollTop -= 12;
  });
  document.addEventListener('pointerup', event => {
    if (!managerPointer || event.pointerId !== managerPointer.pointerId) return;
    const drag = managerPointer; clearManagerDrag();
    if (drag.active && drag.destination) organize({ kind: 'place', source: drag.source, ...drag.destination }, '分类顺序已更新。');
  });
  document.addEventListener('pointercancel', clearManagerDrag);
  $('cancel-merge').addEventListener('click', () => { $('merge-dialog').close(); mergeRequest = null; });
  $('confirm-merge').addEventListener('click', () => { const request = mergeRequest; $('merge-dialog').close(); mergeRequest = null; managerMerge = null; managerMenu = null; if (request) organize(request, '分类已合并。'); });
  $('remove-duplicates').addEventListener('click', () => {
    const keepers = [];
    const ids = duplicatePreview.flatMap((group, index) => {
      const kept = $('duplicate-results').querySelector(`input[name="duplicate-${index}"]:checked`)?.value;
      if (kept) keepers.push({ id: kept, url: group[0].url });
      return kept ? group.filter(row => row.id !== kept).map(row => row.id) : [];
    });
    openDelete(ids, undefined, keepers);
  });
  $('import-parent').addEventListener('change', renderImportPreview);
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    importData = null; $('import-preview').hidden = true;
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('文件最大支持 10 MB。');
      const text = await file.text();
      const value = /\.json$/i.test(file.name) ? JSON.parse(text) : parseBookmarkHtml(text);
      importData = { ...Core.importForest(value), name: file.name };
      toolsMessage(''); renderImportPreview(); $('confirm-import').disabled = busy || !importData;
    } catch (failure) { toolsMessage('读取失败。' + failure.message); }
    event.target.value = '';
  });
  $('confirm-import').addEventListener('click', () => {
    if (importData) organize({ kind: 'import', parentId: $('import-parent').value, forest: importData.forest }, '导入已完成，已有的相同网址已跳过。');
  });

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = element('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('export-menu').hidden = true;
    $('export').setAttribute('aria-expanded', 'false');
    toast('已导出，请查看浏览器下载列表。');
  }

  $('source-nav').addEventListener('click', event => {
    const button = event.target.closest('[data-source]');
    if (button) selectSource(button.dataset.source);
  });
  $('source-select').addEventListener('change', event => selectSource(event.target.value));
  $('source-sections').addEventListener('click', event => {
    const action = event.target.closest('[data-section-action]');
    if (action) { if (action.dataset.sectionAction === 'rename') openFolderRename(true); else deleteFolder(true); return; }
    const button = event.target.closest('[data-scope]');
    if (!button) return;
    cancelFolderRename();
    sourceSection = button.dataset.scope === 'all' ? null : button.dataset.section;
    renderSourceSections();
    renderList(true);
  });
  $('toggle-source-sections').addEventListener('click', () => {
    sourceSectionsExpanded = !sourceSectionsExpanded;
    updateSectionExpansion();
  });
  window.addEventListener('resize', updateSectionExpansion);
  $('rename-category').addEventListener('click', () => openFolderRename(false));
  $('delete-category').addEventListener('click', () => deleteFolder(false));
  $('delete-selected').addEventListener('click', () => openDelete([...selected]));
  $('confirm-delete').addEventListener('click', confirmDelete);
  $('cancel-delete').addEventListener('click', () => { $('delete-dialog').close(); deletion = null; });
  $('delete-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); else deletion = null; });
  icon($('rename-category'), 'pencil');
  icon($('delete-category'), 'trash');
  icon($('save-folder-name'), 'check');
  icon($('cancel-folder-name'), 'close');
  icon($('cancel-prefix'), 'close');
  document.querySelector('.source-title-row').append(renameForm);
  $('folder-rename-form').addEventListener('submit', saveFolderRename);
  $('cancel-folder-name').addEventListener('click', cancelFolderRename);
  $('search').addEventListener('input', event => {
    query = event.target.value.trim().toLocaleLowerCase();
    renderList(true);
  });
  $('bookmark-list').addEventListener('change', event => {
    const id = event.target.dataset.bookmark;
    if (!id) return;
    if (event.target.checked) selected.add(id);
    else selected.delete(id);
    renderSelection();
  });
  $('bookmark-list').addEventListener('click', event => {
    const button = event.target.closest('[data-edit]');
    if (button) openEditor(button.dataset.edit);
    const remove = event.target.closest('[data-delete]');
    if (remove) openDelete([remove.dataset.delete]);
  });
  $('bookmark-list').addEventListener('submit', event => { if (event.target.id === 'inline-editor') saveEditor(event); });
  $('bookmark-list').addEventListener('input', event => {
    if (editing && event.target.closest('#inline-editor')) { editing[event.target.name] = event.target.value; editMessage(''); }
  });
  $('bookmark-list').addEventListener('click', event => {
    if (event.target.closest('#cancel-edit')) cancelEditor();
    if (event.target.closest('#read-page-title')) readPageTitle();
  });
  $('prefix-form').addEventListener('submit', applyPrefix);
  $('open-prefix').addEventListener('click', () => { prefixEditing = true; renderSelection(); $('bulk-prefix').focus(); });
  $('cancel-prefix').addEventListener('click', () => { prefixEditing = false; renderSelection(); });
  $('prefix-form').addEventListener('keydown', event => { if (event.key === 'Escape') { prefixEditing = false; renderSelection(); } });
  $('select-all').addEventListener('change', event => {
    for (const row of filteredRows()) {
      if (event.target.checked) selected.add(row.id);
      else selected.delete(row.id);
    }
    renderSelection();
  });
  $('clear-selection').addEventListener('click', () => { selected.clear(); renderSelection(); });
  $('target-pane').addEventListener('click', event => {
    const button = event.target.closest('.drop-target');
    if (!button) return;
    selectTarget(button);
    const matched = [...$('folder-targets').children].find(folder => folder.dataset.section === target.section);
    if (matched) matched.focus({ preventScroll: true });
  });
  $('move-selected').addEventListener('click', () => move([...selected], { ...target }));
  $('undo').addEventListener('click', undo);
  $('toast-undo').addEventListener('click', undo);
  $('toast-close').addEventListener('click', () => { $('toast').hidden = true; });
  $('refresh').addEventListener('click', () => refresh().then(() => toast(live ? '已读取 Chrome 最新书签。' : '已重新载入本机草稿。')).catch(failure => showNotice(failure.message)));
  function closeTargets(restoreFocus = false) {
    const wasOpen = $('target-pane').classList.contains('open');
    $('target-pane').classList.remove('open');
    $('open-targets').setAttribute('aria-expanded', 'false');
    if (wasOpen && restoreFocus) $('open-targets').focus();
  }

  $('open-targets').addEventListener('click', () => {
    $('target-pane').classList.add('open');
    $('open-targets').setAttribute('aria-expanded', 'true');
    const current = $('target-pane').querySelector('.drop-target[aria-pressed="true"]') || $('target-pane').querySelector('.drop-target');
    (current || $('close-targets')).focus();
  });
  $('close-targets').addEventListener('click', () => closeTargets(true));
  document.addEventListener('focusin', event => {
    if (!event.target.closest('#target-pane, #open-targets')) closeTargets();
  });

  $('bookmark-list').addEventListener('pointerdown', event => {
    if (busy || event.button !== 0 || event.target.closest('a, input, button, form')) return;
    const row = event.target.closest('.bookmark-row');
    if (!row) return;
    event.preventDefault();
    dragIds = selected.has(row.dataset.id) ? [...selected] : [row.dataset.id];
    pointerDrag = { row, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
    row.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    if (!pointerDrag.active && Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 7) return;
    event.preventDefault();
    pointerDrag.active = true;
    document.body.classList.add('is-dragging');
    $('drag-count').textContent = `${dragIds.length} 条书签`;
    $('drag-count').hidden = false;
    $('drag-count').style.transform = `translate(${event.clientX + 16}px, ${event.clientY + 14}px)`;
    for (const item of $('bookmark-list').children) item.classList.toggle('dragging', dragIds.includes(item.dataset.id));
    const destination = document.elementFromPoint(event.clientX, event.clientY)?.closest('.drop-target');
    for (const previous of document.querySelectorAll('.drag-over')) if (previous !== destination) previous.classList.remove('drag-over');
    if (destination) destination.classList.add('drag-over');
    expandDragCategory(destination);
    $('drag-count').textContent = destination ? `${dragIds.length} 条 · 松手移到 ${targetLabel(destination.dataset)}` : `${dragIds.length} 条书签`;
    const bounds = $('folder-targets').getBoundingClientRect();
    if (event.clientX >= bounds.left && event.clientX <= bounds.right) {
      if (event.clientY > bounds.bottom - 30) $('folder-targets').scrollTop += 14;
      if (event.clientY < bounds.top + 30) $('folder-targets').scrollTop -= 14;
    }
  });
  document.addEventListener('pointerup', event => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const destination = pointerDrag.active ? document.elementFromPoint(event.clientX, event.clientY)?.closest('.drop-target') : null;
    const ids = [...dragIds];
    const next = destination ? { category: destination.dataset.category, section: destination.dataset.section } : null;
    clearDrag();
    if (next) move(ids, next);
  });
  document.addEventListener('pointercancel', clearDrag);
  document.addEventListener('dragend', clearDrag);
  $('target-pane').addEventListener('dragover', event => {
    const destination = event.target.closest('.drop-target');
    if (!destination || busy) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = dragIds.length ? 'move' : 'copy';
    for (const previous of document.querySelectorAll('.drag-over')) if (previous !== destination) previous.classList.remove('drag-over');
    destination.classList.add('drag-over');
    expandDragCategory(destination);
  });
  $('target-pane').addEventListener('dragleave', event => {
    const destination = event.target.closest('.drop-target');
    if (destination && !destination.contains(event.relatedTarget)) destination.classList.remove('drag-over');
  });
  $('target-pane').addEventListener('drop', event => {
    const destination = event.target.closest('.drop-target');
    if (!destination || busy) return;
    event.preventDefault();
    const next = { category: destination.dataset.category, section: destination.dataset.section };
    const link = Core.externalLink(event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain'));
    clearDrag();
    if (link) move([], next, link);
    else toast('没有读取到网址，请拖动书签行或浏览器中的网页链接。');
  });

  $('export').addEventListener('click', () => {
    $('export-menu').hidden = !$('export-menu').hidden;
    $('export').setAttribute('aria-expanded', String(!$('export-menu').hidden));
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.export-wrapper')) {
      $('export-menu').hidden = true;
      $('export').setAttribute('aria-expanded', 'false');
    }
  });
  $('export-html').addEventListener('click', () => download(`书签整理_${new Date().toISOString().slice(0, 10)}.html`, Core.exportHtml(tree, ignoredFolderIds), 'text/html;charset=utf-8'));
  $('export-backup').addEventListener('click', () => download(`书签完整备份_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'bookmark-organizer-backup', version: 1, exportedAt: new Date().toISOString(), tree }, null, 2), 'application/json'));
  $('export-changes').addEventListener('click', () => download(`书签操作记录_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, mode: adapter.mode, exportedAt: new Date().toISOString(), operations: adapter.changes }, null, 2), 'application/json'));
  $('connect').addEventListener('click', () => {
    closeTools(); $('connect-panel').hidden = false;
    document.querySelector('.bookmark-pane').classList.add('connecting');
    document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', 'connect-title');
    $('close-connect').focus();
  });
  $('close-connect').addEventListener('click', () => {
    $('connect-panel').hidden = true; document.querySelector('.bookmark-pane').classList.remove('connecting'); document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', 'source-title'); $('connect').focus();
  });
  $('copy-extension-address').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText('chrome://extensions'); toast('地址已复制，请粘贴到 Chrome 地址栏。'); }
    catch { toast('请在 Chrome 地址栏输入 chrome://extensions。'); }
  });
  if (!['http:', 'https:'].includes(location.protocol)) {
    $('download-extension').hidden = true;
    const help = element('p', 'tool-note', '源码用户可运行 npm run build，在 dist 中取得扩展包。');
    $('download-extension').after(help);
  }
  document.addEventListener('keydown', event => {
    if ($('delete-dialog').open || $('merge-dialog').open) return;
    const typing = event.target.closest('input, select, textarea, [contenteditable="true"]');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.target.closest('#inline-editor')) {
      event.preventDefault(); $('search').focus();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !typing) {
      event.preventDefault(); undo();
    }
    if (event.key === 'Escape') {
      if (event.target.closest('#folder-rename-form')) cancelFolderRename();
      if (event.target.closest('#inline-editor')) cancelEditor();
      clearDrag();
      closeTargets(true);
      $('export-menu').hidden = true;
      $('export').setAttribute('aria-expanded', 'false');
    }
  });

  if (!navigator.platform.toLowerCase().includes('mac')) $('search-shortcut').textContent = 'Ctrl K';
  if (adapter.subscribe) adapter.subscribe(scheduleRefresh);
  renderStatus();
  refresh().then(() => { if (adapter.warning) showNotice(adapter.warning); }).catch(failure => {
    showNotice('书签读取失败。' + failure.message);
    $('save-status').textContent = '读取失败，请刷新后重试';
    $('bookmark-list').setAttribute('aria-busy', 'false');
  });
})();
