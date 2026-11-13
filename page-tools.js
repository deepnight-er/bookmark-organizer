(function () {
  'use strict';
  const t = (typeof window !== 'undefined' && window.BookmarkI18n?.t) || ((message, ...values) => message.replace(/\{(\d+)\}/g, (_, index) => String(values[index])));

  function webAddress(value) {
    let url;
    try { url = new URL(value); }
    catch { throw new Error(t("请先填写完整网页地址。")); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(t("网页信息读取支持 HTTP 和 HTTPS 地址。"));
    if (url.username || url.password) throw new Error(t("请先移除网址中的用户名或密码。"));
    return url;
  }

  function metadata(html) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const content = selector => document.querySelector(selector)?.getAttribute('content') || '';
    const clean = text => String(text).replace(/\s+/g, ' ').trim();
    return { title: clean(document.title || content('meta[property="og:title"]')) };
  }

  async function requestSite(value) {
    const url = webAddress(value);
    if (!window.chrome?.permissions) throw new Error(t("请在 Chrome 扩展实时页面使用网页读取。"));
    // Request only the selected site's optional permission from this click.
    const granted = await chrome.permissions.request({ origins: [url.origin + '/*'] });
    if (!granted) throw new Error(t("尚未获得该站点的读取权限，可继续手动改名。"));
    return url;
  }

  async function readPage(url, signal) {
    let response;
    try { response = await fetch(url.href, { credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', signal }); }
    catch (failure) {
      if (signal.aborted) throw failure;
      throw new Error(t("网页读取失败，请打开网址核对访问状态，或手动填写名称。"));
    }
    if (!response.ok) throw new Error(t("网页返回 {0}，可打开网页核对或手动填写名称。", response.status));
    if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw new Error(t("该地址返回的内容没有 HTML 网页标题，可手动填写名称。"));
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2 * 1024 * 1024) throw new Error(t("网页内容超过读取上限，请打开网页核对标题。"));
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const headerEncoding = /charset\s*=\s*["']?([^\s;"']+)/i.exec(response.headers.get('content-type') || '')?.[1];
    const head = new TextDecoder().decode(bytes.slice(0, 4096));
    const metaEncoding = /<meta\b[^>]*charset\s*=\s*["']?([^\s;"'/>]+)/i.exec(head)?.[1];
    let decoder;
    try { decoder = new TextDecoder(headerEncoding || metaEncoding || 'utf-8'); }
    catch { decoder = new TextDecoder(); }
    const info = metadata(decoder.decode(bytes));
    if (!info.title) throw new Error(t("网页没有提供可读取的标题，可手动填写名称。"));
    if (/^(登录|登入|sign[ -]?in|log[ -]?in)(\s*[|·—-].*)?$/i.test(info.title)) throw new Error(t("该地址返回登录页面，请登录后核对名称或手动填写。"));
    return info;
  }

  window.BookmarkPageTools = { webAddress, metadata, requestSite, readPage };
})();
