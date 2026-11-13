(function () {
  'use strict';
  const languages = [
    ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'],
    ['ja', '日本語'], ['ko', '한국어'], ['es', 'Español'], ['fr', 'Français'],
    ['de', 'Deutsch'], ['pt-BR', 'Português (Brasil)'], ['ru', 'Русский'], ['it', 'Italiano'], ['ar', 'العربية']
  ];
  function resolveLanguage(preferences) {
    for (const value of preferences || []) {
      const code = String(value).replaceAll('_', '-').toLowerCase();
      if (code === 'zh' || code.startsWith('zh-')) {
        if (code.includes('-hans')) return 'zh-CN';
        return /-(hant|tw|hk|mo)(-|$)/.test(code) ? 'zh-TW' : 'zh-CN';
      }
      if (code === 'pt' || code.startsWith('pt-')) return 'pt-BR';
      const match = languages.find(([language]) => language.toLowerCase() === code || language === code.split('-')[0]);
      if (match) return match[0];
    }
    return 'en';
  }
  function createTranslator(messages, initialLocale = 'en') {
    let locale = initialLocale;
    return {
      get locale() { return locale; },
      setLocale(value) { locale = languages.some(([code]) => code === value) ? value : 'en'; },
      t(source, ...values) {
        const translated = messages[source]?.[locale] ?? messages[source]?.en ?? source;
        return translated.replace(/\{(\d+)\}/g, (placeholder, index) => {
          const value = values[index];
          if (value === undefined) return placeholder;
          return typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat(locale).format(value) : String(value);
        });
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { languages, resolveLanguage, createTranslator };
    return;
  }

  const storageKey = 'bookmark-organizer-language-v1';
  const storage = window.chrome?.storage?.local;
  const preferences = () => navigator.languages?.length ? navigator.languages : [window.chrome?.i18n?.getUILanguage?.() || navigator.language];
  const translator = createTranslator(window.BOOKMARK_TRANSLATIONS, resolveLanguage(preferences()));
  let preference = 'auto';
  let revision = 0;
  let saves = Promise.resolve();
  const select = document.getElementById('language-select');

  function apply(root = document) {
    for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = translator.t(node.dataset.i18n);
    for (const attribute of ['title', 'aria-label', 'placeholder', 'value']) {
      for (const node of root.querySelectorAll('[data-i18n-' + attribute + ']')) node.setAttribute(attribute, translator.t(node.getAttribute('data-i18n-' + attribute)));
    }
  }
  function applyPreference(value, force = false) {
    const next = value === 'auto' || languages.some(([code]) => code === value) ? value : 'auto';
    const locale = next === 'auto' ? resolveLanguage(preferences()) : next;
    if (!force && preference === next && translator.locale === locale) return;
    preference = next;
    translator.setLocale(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    apply();
    const options = [['auto', translator.t('跟随浏览器')], ...languages];
    select.replaceChildren(...options.map(([code, label]) => {
      const option = document.createElement('option');
      option.value = code; option.textContent = label;
      return option;
    }));
    select.value = preference;
    window.dispatchEvent(new Event('bookmark-languagechange'));
  }
  select.addEventListener('change', () => {
    revision++;
    const value = select.value;
    applyPreference(value);
    saves = saves.then(async () => {
      try {
        if (storage) await storage.set({ [storageKey]: value });
        else localStorage.setItem(storageKey, value);
        document.getElementById('appearance-status').textContent = translator.t('语言已保存到本机。');
      } catch { document.getElementById('appearance-status').textContent = translator.t('语言设置暂用于当前页面。'); }
    });
  });
  const ready = (async () => {
    const initialRevision = revision;
    await Promise.resolve();
    try {
      const saved = storage ? (await storage.get(storageKey))[storageKey] : localStorage.getItem(storageKey);
      if (revision === initialRevision) applyPreference(saved || 'auto', true);
    } catch { applyPreference('auto', true); }
  })();
  window.BookmarkI18n = { t: translator.t, get locale() { return translator.locale; }, get preference() { return preference; }, apply, ready };
  applyPreference('auto', true);
  window.addEventListener('languagechange', () => { if (preference === 'auto') applyPreference('auto', true); });
  window.addEventListener('storage', event => { if (event.key === storageKey) applyPreference(event.newValue || 'auto'); });
  window.chrome?.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes[storageKey]) applyPreference(changes[storageKey].newValue || 'auto');
  });
})();
