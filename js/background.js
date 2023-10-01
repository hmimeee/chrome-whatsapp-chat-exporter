chrome.runtime.onMessage.addListener(
  function (request, sender, sendResponse) {
    if (request == "runContentScript") {
      chrome.tabs.executeScript({
        file: '/js/content_script.js'
      });
    }
  });