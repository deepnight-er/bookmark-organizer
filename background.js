'use strict';

async function openOrganizer() {
  const url = chrome.runtime.getURL('index.html');
  const contexts = await chrome.runtime.getContexts({ documentUrls: [url], contextTypes: ['TAB'] });
  const existing = contexts.find(context => context.tabId >= 0);
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(openOrganizer);
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') openOrganizer().catch(console.error);
});
