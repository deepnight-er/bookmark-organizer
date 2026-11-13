(function () {
  'use strict';
  const t = (typeof window !== 'undefined' && window.BookmarkI18n?.t) || ((message, ...values) => message.replace(/\{(\d+)\}/g, (_, index) => String(values[index])));

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
  let listLimit = 200;
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
  let importJob = null;
  let importReadRevision = 0;
  let mergeRequest = null;
  let duplicatePreview = [];
  let managerQuery = '';
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
    if (['title-name', 'nav-title', 'bookmark-path', 'manager-name', 'target-path'].includes(className)) node.dir = 'auto';
    return node;
  }

  function icon(button, name) {
    const paths = { refresh: 'M13.5 6A5.5 5.5 0 1 0 12.7 12M13.5 2.5V6H10',
      undo: 'M2.5 6a5.5 5.5 0 1 1 .8 6M2.5 2.5V6H6',
      pencil: 'M11.5 3.5 14.5 6.5M3 13l1-4L12 1l3 3-8 8-4 1Z', check: 'm3 8 3 3 7-7', close: 'm4 4 8 8M12 4l-8 8', trash: 'M2 4h12M6 4V2h4v2M4 4l1 10h6l1-10M7 7v4M9 7v4', folder: 'M1.5 4h5l1.5 2h6.5v7h-13V4Z', library: 'M3 2v12M7 2v12M11 2l3 11.5', arrow: 'M4 12 12 4M4 4h8v8', plus: 'M8 3v10M3 8h10', more: 'M3 7v2M8 7v2M13 7v2', chevron: 'm6 4 4 4-4 4', grip: 'M5 3h1M10 3h1M5 8h1M10 8h1M5 13h1M10 13h1' };
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

  function renderActivity() {
    if ($('activity-panel').hidden) return;
    const list = $('activity-list');
    const opened = new Set([...list.querySelectorAll('details[open]')].map(node => node.dataset.operation));
    const records = new Map();
    const undone = new Map();
    for (const entry of adapter.changes) {
      if (entry.type === 'undo') undone.set(Core.operationKey(entry.entry), entry);
      else records.set(Core.operationKey(entry), entry);
    }
    for (const entry of adapter.history) records.set(Core.operationKey(entry), entry);
    const active = new Set(adapter.history.map(Core.operationKey));
    const archived = [...records.values()].filter(entry => !active.has(Core.operationKey(entry))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 200 - adapter.history.length);
    const entries = [...adapter.history, ...archived].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const fragment = document.createDocumentFragment();
    if (!entries.length) {
      const empty = element('div', 'list-message');
      empty.append(element('h3', '', t("还没有操作记录")), element('p', '', t("移动、编辑或删除后，记录会出现在这里。")));
      fragment.append(empty);
    }
    for (const entry of entries) {
      const key = Core.operationKey(entry);
      const available = Core.undoAvailability(adapter.history, key);
      const reversal = undone.get(key);
      const record = element('details', 'activity-record');
      record.dataset.operation = key;
      record.open = opened.has(key);
      const summary = element('summary');
      summary.append(icon(element('span', 'activity-chevron'), 'chevron'));
      const copy = element('span', 'activity-copy');
      const name = element('span', 'activity-name');
      name.append(element('span', '', Core.operationTitle(entry)));
      const subject = entry.before?.title || entry.edits?.[0]?.before.title || entry.folders?.[0]?.before.title || entry.moves?.[0]?.title || entry.created?.[0]?.title || entry.removed?.[0]?.title;
      if (subject) name.append(element('span', 'activity-subject', subject));
      copy.append(name);
      const time = element('time', 'activity-time');
      const date = new Date(entry.at);
      time.textContent = Number.isNaN(date.getTime()) ? t("较早记录") : date.toLocaleString(window.BookmarkI18n.locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      if (!Number.isNaN(date.getTime())) time.dateTime = entry.at;
      copy.append(time);
      const status = available.index >= 0 ? available.reason ? t("需按顺序撤销") : t("可撤销") : reversal ? reversal.skipped ? t("部分恢复") : t("已撤销") : t("仅供查看");
      summary.append(copy, element('span', 'activity-status', status));
      const body = element('div', 'activity-body');
      function populate() {
        if (!record.open || body.childElementCount) return;
        if (available.index >= 0) {
          const actions = element('div', 'activity-actions');
          const button = element('button', 'quiet-button', t("撤销这次操作"));
          button.type = 'button';
          button.dataset.undoOperation = key;
          button.disabled = busy || Boolean(available.reason);
          actions.append(button);
          if (available.reason) actions.append(element('p', 'activity-reason', available.reason));
          body.append(actions);
        }
        if (reversal) {
          const result = reversal.skipped ? t("已恢复 {0} 项，{1} 项因后续变化跳过。", reversal.count || 0, reversal.skipped) : t("这次操作已撤销。");
          body.append(element('p', 'activity-reason', result));
        }
        const details = Core.operationDetails(entry, tree);
        const items = element('ul', 'activity-details');
        let shown = 0;
        const more = element('button', 'text-button');
        more.type = 'button';
        function appendDetails() {
          const end = Math.min(shown + 50, details.length);
          for (const detail of details.slice(shown, end)) {
            const item = element('li');
            item.append(element('h3', '', detail.title));
            for (const [label, value] of [[t("更改前"), detail.before], [t("更改后"), detail.after]]) {
              if (!value) continue;
              const line = element('p', 'activity-change');
              line.append(element('span', 'activity-field', label), element('span', '', value));
              item.append(line);
            }
            if (detail.beforeUrl || detail.afterUrl) {
              const changed = detail.beforeUrl && detail.afterUrl && detail.beforeUrl !== detail.afterUrl;
              if (changed) item.append(element('p', 'activity-url', t("原网址 ") + detail.beforeUrl));
              item.append(element('p', 'activity-url', (changed ? t("新网址 ") : '') + (detail.afterUrl || detail.beforeUrl)));
            }
            if (detail.position) item.append(element('p', 'activity-reason', detail.position));
            items.append(item);
          }
          shown = end;
          more.hidden = shown >= details.length;
          more.textContent = t("再显示 {0} 项", Math.min(50, details.length - shown));
        }
        more.addEventListener('click', appendDetails);
        appendDetails();
        if (!details.length) items.append(element('li', 'activity-reason', t("这条旧记录没有保存详细内容。")));
        body.append(items, more);
      }
      record.addEventListener('toggle', populate);
      record.append(summary, body);
      if (record.open) populate();
      fragment.append(record);
    }
    list.replaceChildren(fragment);
  }

  function closeActivity() {
    closeReleases();
    $('activity-panel').hidden = true;
    $('activity-toggle').setAttribute('aria-expanded', 'false');
    document.querySelector('.bookmark-pane').classList.remove('logging');
    document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', 'source-title');
  }

  $('activity-toggle').addEventListener('click', () => {
    closeTools(); closeHelp();
    $('activity-panel').hidden = false;
    $('activity-toggle').setAttribute('aria-expanded', 'true');
    document.querySelector('.bookmark-pane').classList.add('logging');
    document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', 'activity-title');
    renderActivity();
    $('activity-close').focus();
  });
  $('activity-close').addEventListener('click', () => { closeActivity(); $('activity-toggle').focus(); });
  $('activity-list').addEventListener('click', event => {
    const button = event.target.closest('[data-undo-operation]');
    if (button) undo(button.dataset.undoOperation);
  });

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
    const options = [['all', t("全部书签"), rows.length], ...categories.map(category => [category.title, category.title, category.count])];
    const unfiled = rows.filter(row => !row.category).length;
    if (unfiled) options.push(['unfiled', t("未归类"), unfiled]);
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
    if (resetScroll) listLimit = 200;
    const editor = $('inline-editor');
    const focused = editor?.contains(document.activeElement) ? document.activeElement : null;
    const caret = focused && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    const visible = filteredRows();
    const fragment = document.createDocumentFragment();
    $('source-title').textContent = source === 'all' ? t("全部书签") : source === 'unfiled' ? t("未归类") : source;
    const scope = sourceSection === null ? '' : `${sourceSection || t("直属书签")} · `;
    $('result-count').textContent = scope + (query ? t("找到 {0} 条结果", visible.length) : t("{0} 条书签", visible.length));
    if (!visible.length) {
      const empty = element('div', 'list-message');
      let summary = null;
      if (!query && sourceSection !== '' && categories.some(category => category.title === source)) summary = Core.folderSummary(tree, { category: source, section: sourceSection || '' });
      const childFolders = summary ? summary.folders - summary.variants : 0;
      empty.append(element('h3', '', query ? t("没有找到匹配书签") : childFolders ? t("这个分类包含空文件夹") : t("这个分类暂时没有书签")));
      const message = query ? t("试试更短的名称、域名或分类。") : childFolders ? t("当前范围 0 条书签，包含 ") + childFolders + t(" 个空子文件夹。") : t("从其他分类选中书签，移动到这里。");
      empty.append(element('p', '', message));
      if (childFolders) {
        empty.append(element('p', 'empty-folder-names', summary.childNames.join('、')));
        const manage = element('button', 'quiet-button', t("管理文件夹"));
        manage.type = 'button';
        manage.addEventListener('click', () => { expandedCategories.add(source); $('tools-toggle').click(); showTool('categories'); });
        empty.append(manage);
      }
      fragment.append(empty);
    }
    for (const row of visible.slice(0, listLimit)) {
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
      checkbox.setAttribute('aria-label', t("选择 ") + row.title);
      const copy = element('div', 'bookmark-copy');
      const title = element('h3', 'bookmark-title');
      const parts = Core.titleParts(row.title);
      if (parts.prefix) title.append(element('span', 'title-prefix', parts.prefix));
      title.append(element('span', 'title-name', parts.name || row.host));
      copy.append(title);
      const meta = element('div', 'bookmark-meta');
      meta.append(element('span', 'bookmark-path', row.path), element('span', 'bookmark-host', row.host));
      if (row.syncing) meta.append(element('span', 'storage-tag', t("账号")));
      copy.append(meta);
      item.append(handle, checkbox, copy);
      const actions = element('div', 'bookmark-actions');
      const edit = icon(element('button', 'icon-button edit-bookmark'), 'pencil');
      edit.type = 'button';
      edit.dataset.edit = row.id;
      edit.disabled = busy;
      edit.setAttribute('aria-label', t("编辑 ") + row.title);
      edit.title = t("编辑书签");
      const remove = icon(element('button', 'icon-button danger-icon delete-bookmark'), 'trash');
      remove.type = 'button';
      remove.dataset.delete = row.id;
      remove.disabled = busy;
      remove.setAttribute('aria-label', t("删除 ") + row.title);
      remove.title = t("删除书签");
      try {
        if (['http:', 'https:', 'file:'].includes(new URL(row.url).protocol)) {
          const link = icon(element('a', 'icon-button open-link'), 'arrow');
          link.title = t("打开网页");
          link.href = row.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.draggable = false;
          link.setAttribute('aria-label', t("打开 ") + row.title);
          actions.append(link);
        }
      } catch { /* A saved malformed URL still remains movable. */ }
      actions.append(edit, remove);
      item.append(actions);
      if (editing?.id === row.id) item.append(editor || createEditor());
      fragment.append(item);
    }
    if (visible.length > listLimit) {
      const more = element('button', 'quiet-button list-more', t("再显示 {0} 项", Math.min(200, visible.length - listLimit)));
      more.type = 'button';
      more.dataset.listMore = 'true';
      more.disabled = busy;
      fragment.append(more);
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
    const scopeName = sourceSection === null ? source : sourceSection || t("直属书签");
    $('search').placeholder = source === 'all' || source === 'unfiled' ? t("搜索名称、网址或分类") : t("在「{0}」中搜索名称或网址", scopeName);
    if (!category?.sections.length) { placeFolderRename(); return; }
    const options = [
      { value: null, label: t("全部"), count: category.count },
      ...category.sections.map(section => ({ value: section.title, label: section.title, count: section.count }))
    ];
    const direct = rows.filter(row => row.category === source && !row.sectionRoot).length;
    if (direct || sourceSection === '') options.push({ value: '', label: t("直属书签"), count: direct });
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
        for (const [action, name, label] of [['rename', 'pencil', t("重命名二级分类")], ['delete', 'trash', t("删除二级分类")]]) {
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
    $('toggle-source-sections').textContent = sourceSectionsExpanded ? t("收起分类") : t("展开全部分类");
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
    $('select-label').textContent = selected.size ? t("已选择 {0} 条", selected.size) : t("全选");
    $('selection-summary').textContent = selected.size ? t("已选 {0} 条", selected.size) : t("勾选可批量操作");
    $('move-selected').disabled = busy || selected.size === 0 || !target.category;
    $('move-selected').textContent = busy ? t("正在移动…") : !target.category ? t("先新建分类") : selected.size ? t("移动 {0} 条书签", selected.size) : t("勾选书签后移动");
    $('target-path').textContent = targetLabel(target) || t("尚未选择分类");
    $('target-path').title = targetLabel(target);
    $('move-selected').title = target.category ? t("移入 ") + targetLabel(target) : t("请先在分类管理中新建分类");
    $('undo').disabled = busy || adapter.history.length === 0;
    $('refresh').disabled = busy;
    $('export').disabled = busy;
    $('language-select').disabled = busy;
    $('tools-toggle').disabled = busy;
    $('tools-toggle-mobile').disabled = busy;
    $('activity-toggle').disabled = busy;
    $('releases-toggle').disabled = busy;
    $('clear-history').disabled = busy || !adapter.changes.length && !adapter.history.length;
    renderActivity();
    $('connect').disabled = busy;
    for (const control of $('library-tools').querySelectorAll('input, select, button')) control.disabled = busy || control.dataset.unavailable === 'true';
    $('confirm-import').disabled = busy || !importData || $('confirm-import').dataset.unavailable === 'true';
    $('cancel-import').disabled = !importJob?.active || importJob.controller.signal.aborted;
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
    const more = $('bookmark-list').querySelector('[data-list-more]');
    if (more) more.disabled = busy;
  }

  function renderTargets() {
    const fragment = document.createDocumentFragment();
    for (const category of categories) {
      const button = element('button', 'category-target drop-target' + (category.title === target.category ? ' active' : ''));
      button.type = 'button';
      button.dataset.category = category.title;
      button.dataset.section = '';
      button.setAttribute('aria-label', t("目标分类 ") + category.title);
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
    $('folder-title').textContent = t("子分类");
    $('folder-count').textContent = sections.length ? sections.length + t(" 个") : '';
    const fragment = document.createDocumentFragment();
    for (const section of sections) {
      const button = element('button', 'folder-target drop-target' + (section.title === target.section ? ' active' : ''));
      button.type = 'button';
      button.dataset.category = target.category;
      button.dataset.section = section.title;
      button.setAttribute('aria-label', t("目标文件夹 ") + section.title);
      button.setAttribute('aria-pressed', String(section.title === target.section));
      button.append(element('span', '', section.title), element('small', '', section.count));
      fragment.append(button);
    }
    if (!sections.length) fragment.append(element('p', 'target-empty', category ? t("这个分类没有子分类，可直接移入。") : t("先选择上方分类。")));
    $('folder-targets').replaceChildren(fragment);
    renderSelection();
  }

  function renderStatus() {
    document.querySelector('.release-stage').hidden = window.BOOKMARK_RELEASES.stage === 'published';
    $('mode').textContent = live ? t("Chrome 书签") : t("示例书签");
    $('mode').classList.toggle('live', live);
    $('save-status').textContent = busy ? t("正在处理…") : adapter.updatedAt ? t("已保存") : '';
    $('total-count').textContent = t("共 {0} 条", rows.length);
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
      if (result.error) showNotice(t("{0} 条已完成。{1}", result.count, result.error));
      else toast(result.count ? t("已将 {0} 条书签移到「{1}」", result.count, targetLabel(destination)) : t("这些书签已经在目标分类中。"), result.count > 0);
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) {
      showNotice(failure.message || t("移动失败，请刷新后重试。"));
      await refresh().catch(() => {});
    } finally {
      busy = false;
      renderSelection();
      renderStatus();
      if (refreshPending) { refreshPending = false; scheduleRefresh(); }
    }
  }

  async function undo(operationId) {
    if (busy || !adapter.history.length) return;
    busy = true;
    renderSelection();
    renderStatus();
    try {
      const result = await adapter.undo(operationId);
      if (result.rename) applyFolderRename(result.rename);
      await refresh();
      if (result.error) showNotice(result.error);
      toast(result.error ? t("已恢复 {0} 项，本次撤销尚未完成。", result.count) : t("已恢复 {0} 项", result.count) + (result.skipped ? t("，{0} 项因内容或位置已变化而跳过。", result.skipped) : '。'));
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) {
      showNotice(t("撤销未完成。") + failure.message);
    } finally {
      busy = false;
      renderSelection();
      renderStatus();
      if (operationId && !$('activity-panel').hidden) {
        const record = [...$('activity-list').querySelectorAll('details')].find(node => node.dataset.operation === operationId);
        record?.querySelector('summary').focus();
      }
    }
  }

  function scheduleRefresh() {
    if (busy) { refreshPending = true; return; }
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { refresh().catch(failure => showNotice(t("读取 Chrome 书签失败。") + failure.message)); }, 180);
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
    form.setAttribute('aria-label', t("编辑书签"));
    const fields = element('div', 'inline-fields');
    for (const [key, label, value] of [['prefix', t("前缀"), editing.prefix], ['name', t("名称"), editing.name], ['url', t("网址"), editing.url]]) {
      const field = element('label', 'inline-field field-' + key, label);
      const input = element('input');
      input.id = 'edit-' + key;
      input.name = key;
      input.value = value;
      input.autocomplete = 'off';
      input.required = key !== 'prefix';
      input.disabled = busy || Boolean(nameTask);
      if (key === 'prefix') { input.setAttribute('list', 'prefix-options'); input.placeholder = t("可留空"); }
      if (key === 'url') input.spellcheck = false;
      field.append(input);
      fields.append(field);
    }
    const actions = element('div', 'inline-actions');
    const read = element('button', 'quiet-button', t("读取网页标题"));
    read.id = 'read-page-title';
    read.type = 'button';
    read.disabled = busy || Boolean(nameTask);
    const hint = element('span', 'inline-hint', live ? t("保存后同步，可撤销") : t("保存到草稿，可撤销"));
    const cancel = element('button', 'text-button', t("取消"));
    cancel.type = 'button';
    cancel.id = 'cancel-edit';
    cancel.disabled = busy;
    const save = element('button', 'primary-button', t("保存"));
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
    editMessage(t("正在读取网页标题…首次访问需要允许该站点的读取权限。"));
    const timeout = setTimeout(() => controller.abort(new Error(t("网页读取超时，请重试。"))), 25000);
    try {
      const url = await window.BookmarkPageTools.requestSite(draft.url.trim());
      const info = await window.BookmarkPageTools.readPage(url, controller.signal);
      controller.signal.throwIfAborted();
      if (editing !== draft) return;
      draft.name = info.title;
      if ($('edit-name')) $('edit-name').value = info.title;
      editMessage(t("已填入网页原标题，可直接调整后保存。"));
    } catch (failure) {
      let message = failure.message || t("网页读取失败，可直接手动编辑名称。");
      if (controller.signal.aborted) message = controller.signal.reason?.message === t("网页读取超时，请重试。") ? controller.signal.reason.message : t("已取消网页读取。");
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
      toast(result.count ? t("书签名称和网址已保存。") : t("名称和网址没有变化。"), result.count > 0);
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) {
      if (editing) editMessage(failure.message || t("保存失败，请重试。"), true);
      else showNotice(t("书签已保存，列表刷新失败，请点击刷新。"));
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
    if (editing && selected.has(editing.id)) { editMessage(t("请先保存或取消这条书签的编辑，再应用统一前缀。"), true); return; }
    busy = true;
    renderSelection();
    try {
      const result = await adapter.setPrefix([...selected], $('bulk-prefix').value);
      prefixEditing = false;
      await refresh();
      if (result.error) showNotice(t("{0} 条已完成。{1}", result.count, result.error));
      else toast(result.count ? t("已为 {0} 条书签设置统一前缀。", result.count) : t("所选书签已经使用这个前缀。"), result.count > 0);
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) { showNotice(failure.message || t("前缀更新失败，请重试。")); }
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
    closeHelp();
    closeActivity();
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
    $('folder-name-label').textContent = section ? t("二级分类名称") : t("一级分类名称");
    $('folder-name').value = section ? sourceSection : source;
    $('folder-rename-note').textContent = variants.length > 1 ? t("{0} 处", variants.length) : '';
    $('folder-rename-note').title = t("{0} 个同名文件夹会一起改名", variants.length);
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
        showNotice(t("已改名 {0} 个文件夹。{1}", result.count, result.error));
        $('folder-rename-message').textContent = result.error;
        $('folder-rename-message').hidden = false;
      } else {
        folderRename = null;
        placeFolderRename();
        toast(result.count ? t("分类已改名为「{0}」。", result.rename.after) : t("分类名称没有变化。"), result.count > 0);
      }
      if (adapter.warning) showNotice(adapter.warning);
    } catch (failure) {
      $('folder-rename-message').textContent = failure.message || t("分类改名失败，请刷新后重试。");
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
      $('delete-title').textContent = label ? t("删除「{0}」？", label) : t("删除 {0} 条书签？", plan.bookmarks);
      $('delete-description').textContent = plan.bookmarks ? t("将删除 ") + plan.bookmarks + t(" 条书签") + (plan.folders ? t("及 ") + plan.folders + t(" 个文件夹，范围包含所选目录及下级目录。") : '。') : t("将删除 ") + plan.folders + t(" 个空文件夹，范围包含所选目录及下级目录。");
      $('delete-folders').hidden = !plan.folders;
      $('delete-folders').replaceChildren(...[...plan.nodes].reverse().filter(node => !node.url).slice(0, 20).map(node => element('li', '', node.title)));
      if (plan.folders > 20) $('delete-folders').append(element('li', '', t("另有 ") + (plan.folders - 20) + t(" 个文件夹")));
      $('delete-note').textContent = (plan.bookmarks ? '' : t("范围内共 0 条书签。")) + (live ? t("确认后同步到 Chrome。") : t("确认后更新本地草稿。")) + t("可通过撤销恢复内容与位置。") + (live ? t("恢复后创建时间会更新。") : '');
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
      if (result.error) showNotice(t("已删除 {0} 项，可撤销。{1}", result.count, result.error));
      toast(t("已删除 {0} 项。", result.count), result.count > 0);
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
    input.placeholder = managerEdit.kind === 'rename' ? t("分类名称") : t("新分类名称");
    input.setAttribute('aria-label', managerEdit.kind === 'rename' ? t("修改分类名称") : t("新分类名称"));
    if (managerEdit.kind === 'create') {
      const roots = managerEdit.category ? categories.find(item => item.title === managerEdit.category)?.variants || [] : Core.editableRoots(tree);
      if (roots.length > 1) {
        const select = element('select'); select.name = 'parentId'; select.setAttribute('aria-label', t("创建位置"));
        for (const root of roots) {
          const option = element('option', '', root.title + (root.syncing ? t(" · 账号") : t(" · 本机")));
          option.value = root.id; select.append(option);
        }
        select.value = managerEdit.parentId; form.append(select);
      }
    }
    form.append(input);
    const save = icon(element('button', 'icon-button save-icon'), 'check');
    save.type = 'submit'; save.setAttribute('aria-label', t("保存分类")); save.title = t("保存 · Enter");
    const cancel = managerButton(t("取消编辑分类"), 'close', 'cancel-edit', {});
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
      if (!scope.section && managerQuery) line.append(icon(element('span', 'manager-search-branch'), 'chevron'));
      else if (!scope.section) {
        const expand = managerButton((expandedCategories.has(scope.category) ? t("收起 ") : t("展开 ")) + scope.category, 'chevron', 'expand', scope);
        expand.classList.add('manager-expand'); expand.setAttribute('aria-expanded', String(expandedCategories.has(scope.category)));
        line.append(expand);
      } else line.append(element('span', 'manager-indent'));
      line.append(icon(element('span', 'manager-folder'), 'folder'));
      const editing = managerEdit?.kind === 'rename' && JSON.stringify(managerEdit.scope) === JSON.stringify(scope);
      if (editing) line.append(managerEditor());
      else {
        const name = element('span', 'manager-name', scope.section || scope.category);
        if (!count && nestedFolders) name.append(element('small', 'manager-depth-note', t("含 ") + nestedFolders + t(" 个空子目录")));
        line.append(name, element('span', 'manager-count', count));
        if (!scope.section) line.append(managerButton(t("添加二级分类 ") + scope.category, 'plus', 'create-child', scope));
        line.append(managerButton(t("改名 ") + targetLabel(scope), 'pencil', 'rename', scope), managerButton(t("更多 ") + targetLabel(scope), 'more', 'menu', scope));
      }
      wrapper.append(line);
      if (managerMenu === JSON.stringify(scope)) {
        const actions = element('div', 'manager-row-menu');
        for (const [action, label, direction] of [['up', t("上移"), -1], ['down', t("下移"), 1]]) {
          const button = managerButton(label, null, action, scope);
          try { button.dataset.unavailable = String(!Core.structurePlan(tree, { kind: 'order', target: scope, direction }).steps.length); }
          catch { button.dataset.unavailable = 'true'; }
          button.disabled = busy || button.dataset.unavailable === 'true'; actions.append(button);
        }
        actions.append(managerButton(t("合并到…"), null, 'merge', scope));
        const remove = managerButton(t("删除分类"), null, 'delete', scope); remove.classList.add('danger-text'); actions.append(remove);
        wrapper.append(actions);
      }
      if (managerMerge && JSON.stringify(managerMerge) === JSON.stringify(scope)) {
        const picker = element('div', 'manager-merge-picker');
        const heading = element('div', 'manager-picker-heading');
        heading.append(element('span', '', t("选择要合并到的分类")), managerButton(t("取消合并"), null, 'cancel-merge', scope)); picker.append(heading);
        const targets = folderChoices().filter(([item]) => Boolean(item.section) === Boolean(scope.section) && JSON.stringify(item) !== JSON.stringify(scope));
        for (const [item, label] of targets) picker.append(managerButton(label, null, 'merge-target', item));
        if (!targets.length) picker.append(element('p', 'tool-note', t("还没有其他同级分类。")));
        wrapper.append(picker);
      }
      if (!scope.section && (managerQuery || expandedCategories.has(scope.category))) {
        const children = element('ul', 'manager-children');
        for (const child of hasChildren) children.append(row({ category: scope.category, section: child.title }, child.count, [], child.folderCount));
        if (managerEdit?.kind === 'create' && managerEdit.category === scope.category) {
          const child = element('li', 'manager-new-child'); child.append(managerEditor()); children.append(child);
        }
        if (children.children.length) wrapper.append(children);
      }
      return wrapper;
    }
    for (const category of Core.filterCategories(categories.filter(item => item.variants.length), managerQuery)) list.append(row({ category: category.title, section: '' }, category.count, category.sections));
    fragment.append(list);
    if (!list.children.length && !managerEdit) fragment.append(element('p', 'tool-note', managerQuery ? t("没有找到匹配的分类。") : t("还没有分类，点击“新建分类”开始。")));
    $('category-manager').replaceChildren(fragment);
    for (const control of $('category-manager').querySelectorAll('button,input,select')) control.disabled = busy || control.dataset.unavailable === 'true';
    if (focused && $('manager-name')) { $('manager-name').focus({ preventScroll: true }); if (caret) $('manager-name').setSelectionRange(...caret); }
  }

  $('category-search').addEventListener('input', event => { managerQuery = event.target.value.trim(); renderManager(); });

  function beginManagerEdit(value) {
    managerEdit = value; managerMenu = null; managerMerge = null; toolsMessage('');
    renderManager(); $('manager-name').focus(); $('manager-name').select();
  }

  function openMergePreview(from, to) {
    try {
      const plan = Core.deletionPlan(tree, Core.folderDeletionIds(tree, from));
      mergeRequest = { kind: 'merge', source: from, target: to, signature: Core.deletionSignature(plan) };
      Core.structurePlan(tree, mergeRequest);
      $('merge-description').textContent = t("将「{0}」中的 {1} 条书签合并到「{2}」。", targetLabel(from), plan.bookmarks, targetLabel(to));
      $('merge-dialog').showModal();
    } catch (failure) { toolsMessage(failure.message); }
  }

  function renderDuplicates() {
    const groups = Core.duplicateGroups(tree);
    duplicatePreview = groups.slice(0, 100);
    const fragment = document.createDocumentFragment();
    if (!groups.length) fragment.append(element('p', 'tool-note', t("没有找到相同网址的重复书签。")));
    if (groups.length > 100) fragment.append(element('p', 'tool-note', t("共 {0} 组，本次显示前 100 组。处理后可继续查重。", groups.length)));
    duplicatePreview.forEach((group, index) => {
      const fieldset = element('fieldset', 'duplicate-group');
      fieldset.append(element('legend', '', group[0].url));
      for (const [position, row] of group.entries()) {
        const label = element('label', 'duplicate-choice');
        const radio = element('input');
        radio.type = 'radio'; radio.name = 'duplicate-' + index; radio.value = row.id; radio.checked = position === 0;
        radio.setAttribute('aria-label', t("保留 ") + row.title + '，' + row.path);
        const text = element('span', '', row.title);
        text.append(element('small', '', row.path + (row.syncing ? t(" · 账号") : t(" · 本机"))));
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
      $('confirm-import').dataset.unavailable = String(!plan.steps.length);
      $('confirm-import').disabled = busy || !plan.steps.length;
      $('import-summary').textContent = t("{0} · 将导入 {1} 条，跳过 {2} 条相同网址", importData.name, plan.imported, plan.skipped) + (importData.skipped ? t("、{0} 条无效网址", importData.skipped) : '') + (importData.flattened ? t("。{0} 个深层文件夹折叠到二级路径", importData.flattened) : '');
      $('import-categories').replaceChildren(...importData.forest.filter(node => !node.url).map(node => element('li', '', node.title + ' · ' + Core.count(node) + t(" 条"))));
    } catch (failure) { toolsMessage(failure.message); }
  }

  function renderTools() {
    const toolName = $('library-tools').querySelector('[role="tab"][aria-selected="true"]').id.slice(4);
    $('tools-title').textContent = { categories: t("分类管理"), duplicates: t("查找重复"), import: t("导入备份") }[toolName];
    const roots = Core.editableRoots(tree);
    const rootOptions = roots.map(root => [root.id, root.title + (root.syncing ? t(" · 账号") : t(" · 本机"))]);
    setOptions($('import-parent'), rootOptions);
    renderManager();
    $('confirm-import').disabled = busy || !importData || $('confirm-import').dataset.unavailable === 'true';
    if (!$('tool-duplicates').hidden) renderDuplicates();
    renderImportPreview();
  }

  async function organize(request, message, action) {
    if (busy) return;
    busy = true; toolsMessage(t("正在处理…")); renderSelection(); renderStatus();
    try {
      const result = await (action ? action() : adapter.organize(request));
      await refresh();
      if (result.message) {
        toolsMessage(result.error || '');
        if (result.error) showNotice(result.error);
      } else if (result.error) { showNotice(result.error); toolsMessage(result.error); }
      else { toolsMessage(message); toast(message, result.count > 0); }
      if (adapter.warning) showNotice(adapter.warning);
      return !result.error;
    } catch (failure) { toolsMessage(failure.message); await refresh().catch(() => {}); return false; }
    finally { busy = false; renderSelection(); renderStatus(); if (refreshPending) { refreshPending = false; scheduleRefresh(); } }
  }

  function parseBookmarkHtml(text) {
    const document = new DOMParser().parseFromString(text, 'text/html');
    const root = document.querySelector('dl');
    if (!root) throw new Error(t("文件中没有找到书签目录，请选择浏览器导出的 HTML。"));
    function parse(dl, depth) {
      if (depth > 30) throw new Error(t("文件夹层级过深，请检查导入文件。"));
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

  function toggleTools() {
    const open = $('library-tools').hidden;
    $('library-tools').hidden = !open;
    $('tools-toggle').setAttribute('aria-expanded', String(open));
    document.querySelector('.bookmark-pane').classList.toggle('tools-open', open);
    closeHelp();
    closeActivity();
    $('tools-toggle-mobile').setAttribute('aria-expanded', String(open));
    document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', open ? 'tools-title' : 'source-title');
    $('connect').setAttribute('aria-expanded', 'false');
    if (open) { showTool('categories'); $('tab-categories').focus(); }
  }
  $('tools-toggle').addEventListener('click', toggleTools);
  $('tools-toggle-mobile').addEventListener('click', toggleTools);
  $('tools-close').addEventListener('click', () => {
    closeTools();
    ($('tools-toggle').getClientRects().length ? $('tools-toggle') : $('tools-toggle-mobile')).focus();
  });
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
    $('tools-toggle-mobile').setAttribute('aria-expanded', 'false');
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
    else if (action === 'up' || action === 'down') { organize({ kind: 'order', target: scope, direction: action === 'up' ? -1 : 1 }, t("分类顺序已更新。")); return; }
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
    if (edit.kind === 'create') complete = await organize({ kind: 'create', parentId: edit.parentId, title: edit.title }, t("分类已新建。"));
    else complete = await organize(null, t("分类名称已更新。"), async () => {
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
    $('drag-count').textContent = drag.destination ? t("松手调整分类顺序") : targetLabel(drag.source);
    $('drag-count').style.transform = `translate(${event.clientX + 16}px, ${event.clientY + 14}px)`;
    const panel = $('tool-categories'); const bounds = panel.getBoundingClientRect();
    if (event.clientY > bounds.bottom - 35) panel.scrollTop += 12;
    if (event.clientY < bounds.top + 35) panel.scrollTop -= 12;
  });
  document.addEventListener('pointerup', event => {
    if (!managerPointer || event.pointerId !== managerPointer.pointerId) return;
    const drag = managerPointer; clearManagerDrag();
    if (drag.active && drag.destination) organize({ kind: 'place', source: drag.source, ...drag.destination }, t("分类顺序已更新。"));
  });
  document.addEventListener('pointercancel', clearManagerDrag);
  $('cancel-merge').addEventListener('click', () => { $('merge-dialog').close(); mergeRequest = null; });
  $('confirm-merge').addEventListener('click', () => { const request = mergeRequest; $('merge-dialog').close(); mergeRequest = null; managerMerge = null; managerMenu = null; if (request) organize(request, t("分类已合并。")); });
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
    const revision = ++importReadRevision;
    importData = null; $('import-preview').hidden = true;
    importJob = null; $('import-progress').hidden = true;
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error(t("文件最大支持 10 MB。"));
      const text = await file.text();
      if (revision !== importReadRevision) return;
      const value = /\.json$/i.test(file.name) ? JSON.parse(text) : parseBookmarkHtml(text);
      importData = { ...Core.importForest(value), name: file.name };
      toolsMessage(''); renderImportPreview(); $('confirm-import').disabled = busy || !importData || $('confirm-import').dataset.unavailable === 'true';
    } catch (failure) { if (revision === importReadRevision) toolsMessage(t("读取失败。") + failure.message); }
    event.target.value = '';
  });
  function showImportProgress(progress) {
    Object.assign(importJob, progress);
    $('import-progress-label').textContent = t("已导入 {0} / {1} 条，跳过 {2} 条相同网址。", progress.imported, progress.planned, progress.skipped);
    $('import-progress-bar').max = Math.max(1, progress.total);
    $('import-progress-bar').value = progress.completed;
    $('import-progress-bar').hidden = progress.total === 0;
  }
  function importOutcome(result) {
    const outcome = result.cancelled ? t("导入已停止，已完成的内容已保留。") : result.error ? t("导入中断，已完成的内容已保留。") : t("导入已完成。");
    return outcome + (result.count ? ' ' + t("可在操作记录中撤销本次导入。") : '') + (result.cancelled || result.error ? ' ' + t("再次确认将继续导入剩余内容。") : '');
  }
  $('cancel-import').addEventListener('click', () => {
    if (!importJob?.active) return;
    importJob.controller.abort();
    $('cancel-import').disabled = true;
    $('import-outcome').textContent = t("正在停止，已完成的内容将保留。");
  });
  window.addEventListener('beforeunload', event => {
    if (!importJob?.active) return;
    event.preventDefault();
    event.returnValue = '';
  });
  $('confirm-import').addEventListener('click', async () => {
    if (!importData || busy) return;
    const request = { kind: 'import', parentId: $('import-parent').value, forest: importData.forest };
    importJob = { active: true, controller: new AbortController() };
    $('import-progress').hidden = false;
    $('cancel-import').hidden = false;
    $('import-progress-label').textContent = t("正在处理…");
    $('import-progress-bar').value = 0;
    $('import-progress-bar').hidden = false;
    $('import-outcome').textContent = '';
    await organize(request, '', async () => {
      try {
        const result = await adapter.organize(request, { signal: importJob.controller.signal, onProgress: showImportProgress });
        if (importJob.total !== undefined) showImportProgress({ ...importJob, completed: result.count, imported: result.imported });
        importJob.result = result;
        $('import-outcome').textContent = importOutcome(result);
        return { ...result, message: $('import-outcome').textContent };
      } catch (failure) {
        importJob.result = { count: 0, error: failure.message };
        $('import-progress-label').textContent = t("导入中断，已完成的内容已保留。");
        $('import-progress-bar').hidden = true;
        $('import-outcome').textContent = importOutcome(importJob.result);
        throw failure;
      } finally {
        importJob.active = false;
        $('cancel-import').hidden = true;
      }
    });
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
    toast(t("已导出，请查看浏览器下载列表。"));
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
    if (event.target.closest('[data-list-more]')) {
      const previous = listLimit;
      listLimit += 200;
      renderList();
      $('bookmark-list').querySelectorAll('.bookmark-row')[previous]?.querySelector('input').focus();
      return;
    }
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
  $('undo').addEventListener('click', () => undo());
  $('toast-undo').addEventListener('click', () => undo());
  $('toast-close').addEventListener('click', () => { $('toast').hidden = true; });
  $('refresh').addEventListener('click', () => refresh().then(() => toast(live ? t("已读取 Chrome 最新书签。") : t("已重新载入本机草稿。"))).catch(failure => showNotice(failure.message)));
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
    $('drag-count').textContent = t("{0} 条书签", dragIds.length);
    $('drag-count').hidden = false;
    $('drag-count').style.transform = `translate(${event.clientX + 16}px, ${event.clientY + 14}px)`;
    for (const item of $('bookmark-list').children) item.classList.toggle('dragging', dragIds.includes(item.dataset.id));
    const destination = document.elementFromPoint(event.clientX, event.clientY)?.closest('.drop-target');
    for (const previous of document.querySelectorAll('.drag-over')) if (previous !== destination) previous.classList.remove('drag-over');
    if (destination) destination.classList.add('drag-over');
    expandDragCategory(destination);
    $('drag-count').textContent = destination ? t("{0} 条 · 松手移到 {1}", dragIds.length, targetLabel(destination.dataset)) : t("{0} 条书签", dragIds.length);
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
    else toast(t("没有读取到网址，请拖动书签行或浏览器中的网页链接。"));
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
  $('export-html').addEventListener('click', () => download(t("书签整理_{0}.html", new Date().toISOString().slice(0, 10)), Core.exportHtml(tree, ignoredFolderIds), 'text/html;charset=utf-8'));
  $('export-backup').addEventListener('click', () => download(t("书签完整备份_{0}.json", new Date().toISOString().slice(0, 10)), JSON.stringify({ format: 'bookmark-organizer-backup', version: 1, exportedAt: new Date().toISOString(), tree }, null, 2), 'application/json'));
  $('export-changes').addEventListener('click', () => download(t("书签操作记录_{0}.json", new Date().toISOString().slice(0, 10)), JSON.stringify({ version: 1, mode: adapter.mode, exportedAt: new Date().toISOString(), operations: adapter.changes }, null, 2), 'application/json'));
  $('connect').addEventListener('click', () => {
    closeTools(); closeActivity(); $('connect-panel').hidden = false;
    $('connect').setAttribute('aria-expanded', 'true');
    document.querySelector('.bookmark-pane').classList.add('connecting');
    document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', 'connect-title');
    $('close-connect').focus();
  });
  $('close-connect').addEventListener('click', () => {
    closeHelp(); $('connect').focus();
  });
  function closeHelp() {
    $('connect-panel').hidden = true;
    $('connect').setAttribute('aria-expanded', 'false');
    document.querySelector('.bookmark-pane').classList.remove('connecting');
    document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', 'source-title');
  }
  if (live) {
    $('connection-intro').hidden = true;
    document.querySelector('.connection-install').hidden = true;
  }
  $('copy-extension-address').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText('chrome://extensions'); toast(t("地址已复制，请粘贴到 Chrome 地址栏。")); }
    catch { toast(t("请在 Chrome 地址栏输入 chrome://extensions。")); }
  });
  if (!['http:', 'https:'].includes(location.protocol)) {
    $('download-extension').hidden = true;
    const help = element('p', 'tool-note', t("源码用户可运行 npm run build，在 dist 中取得扩展包。"));
    $('download-extension').after(help);
  }
  document.addEventListener('keydown', event => {
    if ($('delete-dialog').open || $('merge-dialog').open || $('clear-history-dialog').open) return;
    const typing = event.target.closest('input, select, textarea, [contenteditable="true"]');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.target.closest('#inline-editor')) {
      event.preventDefault();
      if (!$('library-tools').hidden && $('tab-categories').getAttribute('aria-selected') === 'true') $('category-search').focus();
      else { closeTools(); closeHelp(); closeActivity(); $('search').focus(); }
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

  function closeReleases() {
    $('releases-panel').hidden = true;
    $('releases-toggle').setAttribute('aria-expanded', 'false');
    document.querySelector('.bookmark-pane').classList.remove('releasing');
  }
  function renderReleases() {
    const data = window.BOOKMARK_RELEASES;
    const list = document.createDocumentFragment();
    if (!data.published.length) list.append(element('p', 'release-empty', t("尚无公开发布版本。")));
    for (const release of data.published) {
      const section = element('section', 'release-entry');
      section.append(element('h3', '', 'v' + release.version), element('time', '', release.date));
      const features = element('ul');
      for (const feature of release.features) features.append(element('li', '', t(feature)));
      section.append(features); list.append(section);
    }
    if (data.stage === 'published') { $('release-history').replaceChildren(list); return; }
    const upcoming = element('section', 'release-upcoming');
    upcoming.append(element('h3', '', 'v' + data.version + ' · ' + t("准备发布")));
    const features = element('ul');
    for (const feature of data.upcoming) features.append(element('li', '', t(feature)));
    upcoming.append(features); list.append(upcoming);
    $('release-history').replaceChildren(list);
  }
  $('releases-toggle').addEventListener('click', () => {
    closeTools(); closeHelp(); closeActivity();
    $('releases-panel').hidden = false;
    $('releases-toggle').setAttribute('aria-expanded', 'true');
    document.querySelector('.bookmark-pane').classList.add('releasing');
    document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', 'releases-title');
    renderReleases(); $('releases-close').focus();
  });
  $('releases-close').addEventListener('click', () => { closeReleases(); document.querySelector('.bookmark-pane').setAttribute('aria-labelledby', 'source-title'); $('releases-toggle').focus(); });
  $('clear-history').addEventListener('click', () => { $('clear-history-error').hidden = true; $('clear-history-dialog').showModal(); });
  $('cancel-clear-history').addEventListener('click', () => { $('clear-history-dialog').close(); $('clear-history').focus(); });
  $('confirm-clear-history').addEventListener('click', async () => {
    if (busy) return;
    busy = true; renderSelection();
    $('confirm-clear-history').disabled = true; $('cancel-clear-history').disabled = true;
    try {
      await adapter.clearHistory();
      $('clear-history-dialog').close();
      await refresh(); toast(t("操作记录已清空。"));
      window.dispatchEvent(new Event('bookmark-storagechange'));
      $('activity-close').focus();
    } catch (failure) { $('clear-history-error').textContent = failure.message; $('clear-history-error').hidden = false; }
    finally { busy = false; renderSelection(); $('confirm-clear-history').disabled = false; $('cancel-clear-history').disabled = false; }
  });

  icon($('refresh'), 'refresh');
  icon($('undo'), 'undo');
  if (!navigator.platform.toLowerCase().includes('mac')) {
    $('search-shortcut').textContent = 'Ctrl K';
    $('undo').title = t("撤销 · Ctrl Z");
  }
  const headerObserver = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--header-height', document.querySelector('.app-header').getBoundingClientRect().height + 'px');
  });
  headerObserver.observe(document.querySelector('.app-header'));
  window.addEventListener('bookmark-languagechange', () => {
    $('inline-editor')?.remove();
    renderNavigation(); renderSourceSections(); renderList(); renderTargets(); renderStatus(); renderTools(); renderReleases();
    if (importJob?.total !== undefined) showImportProgress(importJob);
    if (importJob?.result) $('import-outcome').textContent = importOutcome(importJob.result);
    if (folderRename) $('folder-name-label').textContent = folderRename.section ? t('二级分类名称') : t('一级分类名称');
    if (!navigator.platform.toLowerCase().includes('mac')) $('undo').title = t('撤销 · Ctrl Z');
  });
  if (adapter.subscribe) adapter.subscribe(scheduleRefresh);
  renderStatus();
  window.BookmarkI18n.ready.then(() => refresh()).then(() => { if (adapter.warning) showNotice(adapter.warning); }).catch(failure => {
    showNotice(t("书签读取失败。") + failure.message);
    $('save-status').textContent = t("读取失败，请刷新后重试");
    $('bookmark-list').setAttribute('aria-busy', 'false');
  });
})();
