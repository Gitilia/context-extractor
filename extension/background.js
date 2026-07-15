// background.js — Context Extractor service worker
// Persists the selector chosen via the in-page element picker so the popup
// can pre-fill it the next time it opens.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === "PICKER_SELECTED") {
    const selector = msg.selector || "";
    chrome.storage.session
      .set({ pickerSelector: selector })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // async response
  }

  return false;
});
