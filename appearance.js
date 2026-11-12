(function () {
  'use strict';
  const key = 'bookmark-organizer-appearance-v1';
  const storage = window.chrome?.storage?.local;
  const defaults = { theme: 'system', accent: 'graphite', density: 'comfortable', background: '' };
  let settings = { ...defaults };
  let saves = Promise.resolve();
  const media = matchMedia('(prefers-color-scheme: dark)');
  const $ = id => document.getElementById(id);

  function apply() {
    document.documentElement.dataset.theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
    document.documentElement.dataset.accent = settings.accent;
    document.documentElement.dataset.density = settings.density;
    const image = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(settings.background) ? settings.background : '';
    document.documentElement.style.setProperty('--user-background', image ? `url("${image}")` : 'none');
    document.body.classList.toggle('has-background', Boolean(image));
    $('remove-background').hidden = !image;
    for (const input of document.querySelectorAll('[name="theme"], [name="accent"]')) input.checked = settings[input.name] === input.value;
    $('density').value = settings.density;
  }

  function save() {
    const value = { ...settings };
    saves = saves.then(async () => {
      try {
        if (storage) await storage.set({ [key]: value });
        else localStorage.setItem(key, JSON.stringify(value));
        $('appearance-status').textContent = '外观已保存到本机';
      } catch { $('appearance-status').textContent = '存储空间不足，外观暂用于当前页面。可移除背景图片后重试。'; }
    });
  }

  function close(restoreFocus = false) {
    $('appearance-panel').hidden = true;
    $('appearance-toggle').setAttribute('aria-expanded', 'false');
    if (restoreFocus) $('appearance-toggle').focus();
  }

  $('appearance-toggle').addEventListener('click', () => {
    const open = $('appearance-panel').hidden;
    $('appearance-panel').hidden = !open;
    $('appearance-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('appearance-panel').querySelector('[name="theme"]:checked').focus();
  });
  $('appearance-close').addEventListener('click', () => close(true));
  document.addEventListener('click', event => { if (!event.target.closest('#appearance-panel, #appearance-toggle')) close(); });
  document.addEventListener('focusin', event => { if (!event.target.closest('#appearance-panel, #appearance-toggle')) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('appearance-panel').hidden) close(true); });
  $('appearance-panel').addEventListener('change', event => {
    const input = event.target;
    if (input.name === 'theme' || input.name === 'accent') settings[input.name] = input.value;
    else if (input.id === 'density') settings.density = input.value;
    else return;
    apply(); save();
  });
  $('background-file').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      $('appearance-status').textContent = '请选择 2 MB 以内的 PNG、JPEG 或 WebP 图片。';
      event.target.value = ''; return;
    }
    const reader = new FileReader();
    reader.onload = () => { settings.background = reader.result; apply(); save(); };
    reader.onerror = () => { $('appearance-status').textContent = '图片读取失败，请重新选择。'; };
    reader.readAsDataURL(file);
    event.target.value = '';
  });
  $('remove-background').addEventListener('click', () => { settings.background = ''; apply(); save(); });
  media.addEventListener('change', apply);
  (async () => {
    try {
      const saved = storage ? (await storage.get(key))[key] : JSON.parse(localStorage.getItem(key) || 'null');
      if (saved) {
        settings = { ...defaults, ...saved };
        for (const [name, allowed] of Object.entries({ theme: ['system', 'light', 'dark'], accent: ['graphite', 'blue', 'rust', 'teal'], density: ['comfortable', 'compact'] })) {
          if (!allowed.includes(settings[name])) settings[name] = defaults[name];
        }
        if (typeof settings.background !== 'string') settings.background = '';
      }
    } catch { $('appearance-status').textContent = '外观暂用于当前页面。'; }
    apply();
  })();
})();
