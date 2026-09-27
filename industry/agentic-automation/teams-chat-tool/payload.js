(function () {
  if (window._teamsExtractorLoaded) return;
  window._teamsExtractorLoaded = true;

  var LEGACY_SELECTORS = {
    chatList: ['#chat-pane-list'],
    timestamp: ['[id^="timestamp-"]'],
    messageBody: ['[id^="message-body-"]'],
    animatedGif: ['[aria-label="Animated GIF"]'],
    emojiImage: ['img[itemtype*="Emoji"]'],
    mentionBlock: ['div[aria-label*="Mention"]'],
    quotedReply: ['div[data-track-module-name="messageQuotedReply"]'],
    author: ['[data-tid="message-author-name"]'],
    content: ['[id^="message-body-"] [id^="content-"]']
  };

  var selectorDiagnostics = {};
  var paused = false;
  var lastCollected = [];
  var GLOBAL_PAUSE_KEY = '__teamsExtractorPauseRequested';
  var activeTabId = null;

  function setPauseRequested(value) {
    paused = !!value;
    window[GLOBAL_PAUSE_KEY] = !!value;
  }

  function isPauseRequested() {
    return paused || window[GLOBAL_PAUSE_KEY] === true;
  }

function filterAndSortNodes(nodes) {
  if (!nodes || nodes.length === 0) return [];
  var map = new Map();
  nodes.forEach(function (n) {
    try {
      var msg = queryOne(n, 'messageBody');
      var id = msg ? resolveMessageId(msg) : null;
      if (!id) {
        var ts = resolveTimestamp(n);
        var content = queryOne(n, 'content');
        var text = content ? content.innerText.substring(0, 30) : '';
        if (ts && ts.value) id = ts.value + '|' + text;
        else id = 'UNKNOWN|' + text;
      }
      if (!map.has(id)) map.set(id, n);
    } catch (e) {
      // ignore malformed node
    }
  });
  var arr = Array.from(map.values());
  arr.sort(function (a, b) {
    var ta = resolveTimestamp(a) && resolveTimestamp(a).date ? resolveTimestamp(a).date.getTime() : 0;
    var tb = resolveTimestamp(b) && resolveTimestamp(b).date ? resolveTimestamp(b).date.getTime() : 0;
    return ta - tb;
  });
  return arr;
}

  function sendMsg(data) {
    chrome.runtime.sendMessage(data).catch(function () {});
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function createRunId() {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'run-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function parseLocalDateRange(startDate, endDate) {
    if (!startDate || !endDate) return null;
    var start = new Date(startDate + 'T00:00:00');
    var end = new Date(endDate + 'T23:59:59.999');
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return null;
    }
    return { start: start, end: end };
  }

  function normalizeSelectorList(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') return [value];
    return [];
  }

  // New: unified configured selectors array per component.
  function getConfiguredSelectors(key) {
    var config = window.TEAMS_SELECTOR_CONFIG && window.TEAMS_SELECTOR_CONFIG.selectors;
    var entry = config ? config[key] : null;
    if (!entry) return [];
    // New shape: entry.selectors is the canonical array
    if (entry.selectors) return normalizeSelectorList(entry.selectors);
    // Backwards compat: support old {tid:[], aria:[]} shape
    var combined = [];
    if (entry.tid) combined = combined.concat(normalizeSelectorList(entry.tid));
    if (entry.aria) combined = combined.concat(normalizeSelectorList(entry.aria));
    if (Array.isArray(entry)) return normalizeSelectorList(entry);
    if (typeof entry === 'string') return [entry];
    return combined;
  }

  function isSelectorSyntaxValid(selector) {
    try {
      document.querySelector(selector);
      return true;
    } catch (e) {
      return false;
    }
  }

  function isUsableMatch(key, match) {
    if (!match) return false;

    if (key === 'chatList') {
      var messageMarkers = match.querySelectorAll(
        '[id^="message-body-"], [data-tid="message-body"], [data-tid="chat-message"]'
      ).length;
      var timestampMarkers = match.querySelectorAll(
        '[id^="timestamp-"], time[datetime], [data-tid="message-timestamp"]'
      ).length;
      return match.id === 'chat-pane-list'
        || (messageMarkers >= 2 && timestampMarkers >= 2);
    }
    if (key === 'timestamp') {
      var dt = match.getAttribute('datetime');
      return !!dt && !Number.isNaN(new Date(dt).getTime());
    }
    if (key === 'messageBody') {
      return (match.id && match.id.indexOf('message-body-') === 0)
        || !!match.closest('[id^="message-body-"]')
        || (match.getAttribute('data-tid') || '') === 'message-body'
        || (match.getAttribute('data-tid') || '') === 'chat-pane-message'
        || (match.className || '').indexOf('fui-ChatMessage__body') >= 0;
    }
    if (key === 'animatedGif') {
      var gifLabel = (match.getAttribute('aria-label') || '').toLowerCase();
      return gifLabel.indexOf('animated gif') >= 0 || gifLabel.indexOf('gif') >= 0;
    }
    if (key === 'emojiImage') {
      return match.tagName === 'IMG' && !!match.getAttribute('alt');
    }
    if (key === 'mentionBlock') {
      var mentionText = match.innerText.trim();
      return mentionText.length > 0 && mentionText.charAt(0) === '@';
    }
    if (key === 'quotedReply') {
      return match.innerText.trim().length > 0 && !!match.closest('[id^="message-body-"]');
    }
    if (key === 'author') {
      return match.innerText.trim().length > 0 || (match.id && match.id.indexOf('author-') === 0);
    }
    if (key === 'content') {
      return (match.id && match.id.indexOf('content-') === 0) || match.innerText.trim().length > 0 || match.hasAttribute('data-message-content');
    }

    return true;
  }

  function recordSelectorStatus(key, type, selector, configTried, fallbackTried) {
    selectorDiagnostics[key] = {
      type: type,
      selector: selector || '',
      configTried: configTried || 0,
      fallbackTried: fallbackTried || 0
    };
  }

  function initializeSelectorDiagnostics() {
    selectorDiagnostics = {};
  }

  function queryOne(root, key) {
    var configured = getConfiguredSelectors(key);
    var fallback = LEGACY_SELECTORS[key] || [];
    var i;

    // Try configured selectors (in order)
    for (i = 0; i < configured.length; i++) {
      var sel = configured[i];
      var configuredMatch = null;
      try { configuredMatch = root.querySelector(sel); } catch (e) { console.warn('[Teams Extractor] Invalid configured selector for ' + key + ': ' + sel); }
      if (isUsableMatch(key, configuredMatch)) {
        recordSelectorStatus(key, 'config', sel, configured.length, fallback.length);
        return configuredMatch;
      }
    }

    // Fall back to legacy selectors
    for (i = 0; i < fallback.length; i++) {
      var fallbackMatch = null;
      try { fallbackMatch = root.querySelector(fallback[i]); } catch (e) { console.warn('[Teams Extractor] Invalid fallback selector for ' + key + ': ' + fallback[i]); }
      if (isUsableMatch(key, fallbackMatch)) {
        recordSelectorStatus(key, 'fallback', fallback[i], configured.length, fallback.length);
        return fallbackMatch;
      }
    }

    return null;
  }

  function queryAll(root, key) {
    var configured = getConfiguredSelectors(key);
    var fallback = LEGACY_SELECTORS[key] || [];
    var i;

    for (i = 0; i < configured.length; i++) {
      var sel = configured[i];
      var configuredMatches = [];
      try { configuredMatches = root.querySelectorAll(sel); } catch (e) { console.warn('[Teams Extractor] Invalid configured selector for ' + key + ': ' + sel); }
      configuredMatches = Array.from(configuredMatches).filter(function (match) { return isUsableMatch(key, match); });
      if (configuredMatches.length > 0) {
        recordSelectorStatus(key, 'config', sel, configured.length, fallback.length);
        return configuredMatches;
      }
    }

    for (i = 0; i < fallback.length; i++) {
      var fallbackMatches = [];
      try { fallbackMatches = root.querySelectorAll(fallback[i]); } catch (e) { console.warn('[Teams Extractor] Invalid fallback selector for ' + key + ': ' + fallback[i]); }
      fallbackMatches = Array.from(fallbackMatches).filter(function (match) { return isUsableMatch(key, match); });
      if (fallbackMatches.length > 0) {
        recordSelectorStatus(key, 'fallback', fallback[i], configured.length, fallback.length);
        return fallbackMatches;
      }
    }

    return [];
  }

  function resolveTimestamp(node) {
    var timeEl = queryOne(node, 'timestamp');
    if (!timeEl) return null;
    var timestamp = timeEl.getAttribute('datetime')
      || timeEl.getAttribute('data-timestamp')
      || timeEl.getAttribute('title')
      || '';
    var parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return {
      value: timestamp,
      date: parsed
    };
  }

  function resolveMessageId(messageBodyEl) {
    if (!messageBodyEl) return '';
    if (messageBodyEl.id && messageBodyEl.id.indexOf('message-body-') === 0) {
      return messageBodyEl.id.replace('message-body-', '');
    }

    var closestMessage = messageBodyEl.closest('[id^="message-body-"]');
    if (closestMessage && closestMessage.id) {
      return closestMessage.id.replace('message-body-', '');
    }

    var dataMessageId = messageBodyEl.getAttribute('data-message-id') || '';
    if (dataMessageId) return dataMessageId;

    var dataTid = messageBodyEl.getAttribute('data-tid') || '';
    var fromTid = dataTid.match(/(\d+)/);
    return fromTid ? fromTid[1] : '';
  }

  function resolveChatList() {
    return queryOne(document, 'chatList');
  }

  function findScrollContainer(el) {
    var current = el;
    while (current && current !== document.documentElement) {
      var style = getComputedStyle(current);
      var ov = style.overflowY;
      if ((ov === 'auto' || ov === 'scroll') && current.scrollHeight > current.clientHeight) {
        return current;
      }
      current = current.parentElement;
    }
    current = el;
    while (current && current !== document.documentElement) {
      if (current.scrollTop > 0 && current.scrollHeight > current.clientHeight) {
        return current;
      }
      current = current.parentElement;
    }
    if (el.scrollHeight > el.clientHeight) return el;
    return null;
  }

  function getOldestTimestamp(nodes) {
    var oldest = null;
    for (var i = 0; i < nodes.length; i++) {
      var ts = resolveTimestamp(nodes[i]);
      if (ts) {
        if (!oldest || ts.date < oldest) oldest = ts.date;
      }
    }
    return oldest;
  }

  function countUnique(nodes) {
    var ids = new Set();
    for (var i = 0; i < nodes.length; i++) {
      var msg = queryOne(nodes[i], 'messageBody');
      if (msg) ids.add(msg.id);
    }
    return ids.size;
  }

  function filterAndSort(nodes) {
    var map = new Map();
    nodes.forEach(function (n) {
      var msg = queryOne(n, 'messageBody');
      if (msg && !queryOne(n, 'animatedGif')) {
        var messageId = resolveMessageId(msg);
        var id = parseInt(messageId, 10);
        if (!Number.isNaN(id) && !map.has(id)) map.set(id, n);
      }
    });
    return Array.from(map.entries())
      .sort(function (a, b) { return a[0] - b[0]; })
      .map(function (entry) { return entry[1]; });
  }

  function replaceEmojiImages(node) {
    Array.from(queryAll(node, 'emojiImage')).forEach(function (img) {
      var span = document.createElement('span');
      span.innerText = img.alt || '';
      img.parentNode.replaceChild(span, img);
    });
  }

  function replaceMentions(node) {
    Array.from(queryAll(node, 'mentionBlock')).forEach(function (div) {
      var span = document.createElement('span');
      span.innerHTML = div.innerHTML;
      span.className = div.className;
      span.style.fontWeight = 'bold';
      div.parentNode.insertBefore(span, div);
      div.parentNode.removeChild(div);
    });
  }

  function replaceQuotedReplies(node) {
    Array.from(queryAll(node, 'quotedReply')).forEach(function (div) {
      var blockquote = document.createElement('blockquote');
      blockquote.innerHTML = div.innerHTML;
      blockquote.className = div.className;
      div.parentNode.insertBefore(blockquote, div);
      div.parentNode.removeChild(div);
    });
  }

  function getAttachmentFileName(el) {
    if (!el) return '';

    var title = (el.getAttribute('title') || '').trim();
    if (title) {
      var titleFirstLine = title.split(/\r?\n/)[0].trim();
      if (titleFirstLine) return titleFirstLine;
    }

    var ariaLabel = (el.getAttribute('aria-label') || '').trim();
    if (ariaLabel) {
      var fileFromLabel = ariaLabel.match(/(?:file\s+attachment|file)\s+([^\.\n]+(?:\.[a-z0-9]{1,10})?)/i);
      if (fileFromLabel && fileFromLabel[1]) return fileFromLabel[1].trim();
    }

    var dataTid = (el.getAttribute('data-tid') || '').trim();
    if (dataTid.indexOf('file-chiclet-') === 0) {
      return dataTid.replace('file-chiclet-', '').trim();
    }


  function extractChatName() {
    // Try a few likely selectors for the conversation header/title
    var selectors = [
      '[data-tid="conversation-header-title"]',
      '[data-tid="thread-subject"]',
      '[data-tid*="conversation"]',
      '[role="heading"]',
      'h1',
      'div[aria-label*="Conversation"]'
    ];
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = document.querySelector(selectors[i]);
        if (el) {
          var text = (el.innerText || el.textContent || '').trim();
          if (text) return text.split(/\r?\n/)[0].trim();
        }
      } catch (e) {
        // ignore selector errors
      }
    }

    // Fallback to title string if DOM selectors didn't find anything
    var title = (document.title || '').replace(/\s*-\s*Microsoft Teams\s*$/i, '').trim();
    return title || '';
  }
    var firstLine = (el.innerText || '').split(/\r?\n/)[0].trim();
    if (firstLine && !/^https?:\/\//i.test(firstLine)) return firstLine;

    return '';
  }

  function inferAttachmentKind(el, fileName) {
    var hint = [
      fileName || '',
      el ? (el.getAttribute('filepreviewtype') || '') : '',
      el ? (el.getAttribute('data-tid') || '') : '',
      el ? (el.getAttribute('data-testid') || '') : '',
      el ? (el.getAttribute('aria-label') || '') : ''
    ].join(' ').toLowerCase();

    var ext = '';
    var extMatch = (fileName || '').toLowerCase().match(/\.([a-z0-9]{1,10})$/);
    if (extMatch) ext = extMatch[1];

    if (hint.indexOf('video') >= 0 || ['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', 'wmv'].indexOf(ext) >= 0) return 'video';
    if (hint.indexOf('image') >= 0 || ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'heic', 'heif'].indexOf(ext) >= 0) return 'image';
    if (hint.indexOf('audio') >= 0 || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma'].indexOf(ext) >= 0) return 'audio';
    if (['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'ods', 'numbers'].indexOf(ext) >= 0) return 'sheet';
    if (['ppt', 'pptx', 'odp', 'key'].indexOf(ext) >= 0) return 'slides';
    if (['doc', 'docx', 'odt', 'rtf', 'pages'].indexOf(ext) >= 0) return 'document';
    if (ext === 'pdf') return 'pdf';
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].indexOf(ext) >= 0) return 'archive';
    if (['txt', 'md', 'json', 'xml', 'yaml', 'yml', 'html', 'css', 'js', 'ts', 'py', 'java', 'c', 'cpp', 'cs', 'go', 'rs', 'php', 'sh', 'sql', 'log'].indexOf(ext) >= 0) return 'text';
    return 'file';
  }

  function attachmentEmoji(kind) {
    if (kind === 'video') return '🎬';
    if (kind === 'image') return '🖼️';
    if (kind === 'audio') return '🎵';
    if (kind === 'sheet') return '📊';
    if (kind === 'slides') return '📽️';
    if (kind === 'document') return '📄';
    if (kind === 'pdf') return '📕';
    if (kind === 'archive') return '🗜️';
    if (kind === 'text') return '🧾';
    return '📎';
  }

  function attachmentKindLabel(kind) {
    if (kind === 'video') return 'Video attachment';
    if (kind === 'image') return 'Image attachment';
    if (kind === 'audio') return 'Audio attachment';
    if (kind === 'sheet') return 'Spreadsheet attachment';
    if (kind === 'slides') return 'Slides attachment';
    if (kind === 'document') return 'Document attachment';
    if (kind === 'pdf') return 'PDF attachment';
    if (kind === 'archive') return 'Archive attachment';
    if (kind === 'text') return 'Text attachment';
    return 'File attachment';
  }

  function replaceAttachmentsWithEmoji(node) {
    if (!node) return;

    var selector = [
      '[data-testid="file-attachment"]',
      '[data-tid^="file-chiclet-"]',
      '[data-testid="rich-file-preview-button"]',
      '[data-tid="file-preview-root"]',
      '[data-tid="video-attachment-root"]',
      '[data-testid="video-placeholder"]',
      '[data-tid="video-placeholder"]'
    ].join(', ');

    var allCandidates = Array.from(node.querySelectorAll(selector));
    if (allCandidates.length === 0) return;

    // Keep only top-level candidates to avoid duplicate placeholders for nested attachment DOM.
    var candidates = allCandidates.filter(function (el) {
      return !allCandidates.some(function (other) { return other !== el && other.contains(el); });
    });

    candidates.forEach(function (el) {
      if (!el || !el.parentNode) return;

      var fileName = getAttachmentFileName(el);
      var kind = inferAttachmentKind(el, fileName);
      var emoji = attachmentEmoji(kind);
      var label = attachmentKindLabel(kind);
      var text = fileName
        ? '[' + emoji + ' ' + label + ': ' + fileName + ']'
        : '[' + emoji + ' ' + label + ']';

      var span = document.createElement('span');
      span.className = 'attachment-placeholder';
      span.textContent = text;
      el.parentNode.replaceChild(span, el);
    });
  }

  function collectAttachmentPlaceholderTexts(node) {
    if (!node) return [];
    return Array.from(node.querySelectorAll('.attachment-placeholder'))
      .map(function (el) { return (el.textContent || '').trim(); })
      .filter(Boolean);
  }

  function hydrateImageSources(root) {
    if (!root) return;
    Array.from(root.querySelectorAll('img')).forEach(function (img) {
      if (img.getAttribute('src')) return;
      var src = img.getAttribute('data-orig-src')
        || img.getAttribute('data-gallery-src')
        || img.getAttribute('data-src')
        || getFirstSrcsetUrl(img.getAttribute('srcset'))
        || img.currentSrc
        || '';
      if (src) {
        img.setAttribute('src', src);
      }
    });
  }

  function getFirstSrcsetUrl(srcset) {
    if (!srcset) return '';
    var first = String(srcset).split(',')[0].trim();
    if (!first) return '';
    return first.split(/\s+/)[0] || '';
  }

  var TRANSPARENT_PIXEL_DATA_URI = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

  function hasUsableImageSource(img) {
    if (!img) return false;
    return !!(img.currentSrc
      || img.getAttribute('src')
      || img.getAttribute('data-src')
      || img.getAttribute('data-orig-src')
      || img.getAttribute('data-gallery-src')
      || getFirstSrcsetUrl(img.getAttribute('srcset')));
  }

  function replaceUnresolvedImages(root) {
    if (!root) return;
    Array.from(root.querySelectorAll('img')).forEach(function (img) {
      if (hasUsableImageSource(img)) return;
      var placeholder = document.createElement('span');
      placeholder.textContent = '[Image unavailable]';
      placeholder.className = 'image-unavailable';
      img.parentNode.replaceChild(placeholder, img);
    });
  }

  async function waitForImagesToSettle(root, timeoutMs) {
    if (!root) return;
    var deadline = Date.now() + (timeoutMs || 0);
    while (Date.now() < deadline) {
      var pending = Array.from(root.querySelectorAll('img')).some(function (img) {
        return !hasUsableImageSource(img) && (!img.complete || img.naturalWidth <= 1);
      });
      if (!pending) return;
      await sleep(250);
    }
  }

  function resolveImageSource(imgEl) {
    if (!imgEl) return '';
    var candidates = [
      imgEl.getAttribute('data-orig-src'),
      imgEl.getAttribute('data-gallery-src'),
      imgEl.getAttribute('data-src'),
      getFirstSrcsetUrl(imgEl.getAttribute('srcset')),
      imgEl.currentSrc,
      imgEl.getAttribute('src')
    ].filter(Boolean);
    for (var i = 0; i < candidates.length; i += 1) {
      if (!isBlobUrl(candidates[i])) return candidates[i];
    }
    return candidates[0] || '';
  }

  function isBlobUrl(url) {
    return typeof url === 'string' && /^blob:/i.test(url);
  }

  async function captureImageBlob(sourceUrl) {
    if (!isBlobUrl(sourceUrl)) return null;
    try {
      var response = await fetch(sourceUrl);
      if (!response.ok) return null;
      var blob = await response.blob();
      return {
        buffer: await blob.arrayBuffer(),
        contentType: blob.type || ''
      };
    } catch (e) {
      return null;
    }
  }

  async function captureImagesAndMarkHtml(container) {
    var images = Array.from(container.querySelectorAll('img'));
    var captured = [];
    for (var i = 0; i < images.length; i += 1) {
      var imgEl = images[i];
      var imageId = 'img-' + Date.now() + '-' + i + '-' + Math.random().toString(16).slice(2);
      var sourceUrl = resolveImageSource(imgEl);
      if (!sourceUrl) continue;
      var imageBlob = await captureImageBlob(sourceUrl);
      captured.push({
        imageId: imageId,
        sourceUrl: sourceUrl,
        contentType: imageBlob ? imageBlob.contentType : '',
        blobBuffer: imageBlob ? imageBlob.buffer : null,
        element: imgEl
      });
    }
    return captured;
  }

  function buildTranscript(nodes) {
    var lastAuthor = '';
    var lastDate = null;
    var output = document.createElement('div');
    var rows = [];

    nodes.forEach(function (n) {
      var clone = n.cloneNode(true);
      replaceEmojiImages(clone);
      replaceMentions(clone);
      replaceQuotedReplies(clone);
      replaceAttachmentsWithEmoji(clone);

      var authorEl = queryOne(clone, 'author');
      var messageBodyEl = queryOne(clone, 'messageBody');
      var bodyEl = queryOne(clone, 'content');
      var resolvedTs = resolveTimestamp(clone);

      if (!authorEl || !resolvedTs || !messageBodyEl || !bodyEl) return;

      var author = authorEl.innerText.trim();
      var ts = resolvedTs.date;
      var timestamp = resolvedTs.value;
      var tsStr = ts.toLocaleString();
      var date = tsStr.split(',')[0];
      var newDay = lastDate && ts.toDateString() !== lastDate.toDateString();
      var messageId = resolveMessageId(messageBodyEl);
      if (!messageId) return;

      var attachmentTexts = collectAttachmentPlaceholderTexts(clone);

      var messageDiv = document.createElement('div');
      messageDiv.className = 'message';

      if (author !== lastAuthor) {
        messageDiv.appendChild(document.createElement('hr'));
        var b = document.createElement('b');
        b.textContent = author;
        messageDiv.appendChild(b);
        var timeSpan = document.createElement('span');
        timeSpan.textContent = ' [' + tsStr + ']:';
        messageDiv.appendChild(timeSpan);
        messageDiv.appendChild(document.createElement('br'));
      } else if (newDay) {
        var divider = document.createElement('div');
        divider.className = 'divider';
        divider.innerHTML = '<hr/>' + date + '<hr/>';
        messageDiv.appendChild(divider);
      }

      lastAuthor = author;
      lastDate = ts;

      var section = document.createElement('section');
      section.innerHTML = bodyEl.innerHTML;

      // Some Teams layouts keep attachments outside the main content node.
      // Ensure extracted placeholders are still represented in transcript output.
      var existingText = section.innerText || '';
      attachmentTexts.forEach(function (text) {
        if (existingText.indexOf(text) >= 0) return;
        var line = document.createElement('div');
        line.className = 'attachment-placeholder-line';
        line.textContent = text;
        section.appendChild(line);
      });

      hydrateImageSources(section);
      replaceUnresolvedImages(section);
      messageDiv.appendChild(section);

      var contentText = section.innerText.trim();
      messageDiv.setAttribute('data-message-id', messageId);
      messageDiv.setAttribute('data-timestamp', timestamp);
      messageDiv.setAttribute('data-author', author);
      messageDiv.setAttribute('data-content-text', contentText);

      output.appendChild(messageDiv);
      rows.push({
        messageId: messageId,
        timestamp: timestamp,
        author: author,
        contentText: contentText
      });
    });

    return { html: output.innerHTML, rows: rows };
  }

  function buildSelectorDiagnosticsSummary() {
    var keys = Object.keys(LEGACY_SELECTORS);
    var configComponents = [];
    var fallbackComponents = [];
    var unresolvedComponents = [];
    var components = {};

    keys.forEach(function (key) {
      var item = selectorDiagnostics[key];
      if (item && item.selector) {
        // Use recorded runtime result if available
        components[key] = {
          type: item.type,
          selector: item.selector,
          configTried: item.configTried,
          fallbackTried: item.fallbackTried
        };
        if (item.type === 'config') configComponents.push(key);
        if (item.type === 'fallback') fallbackComponents.push(key);
      } else {
        // No runtime selection recorded — infer from configured selectors and fallbacks
        var configured = getConfiguredSelectors(key) || [];
        var fallback = LEGACY_SELECTORS[key] || [];
        var status = 'unresolved';
        var selector = '';

        for (var i = 0; i < configured.length; i++) {
          if (isSelectorSyntaxValid(configured[i])) {
            status = 'config';
            selector = configured[i];
            break;
          }
        }

        if (!selector) {
          for (var f = 0; f < fallback.length; f++) {
            if (isSelectorSyntaxValid(fallback[f])) {
              status = 'fallback';
              selector = fallback[f];
              break;
            }
          }
        }

        components[key] = {
          type: status,
          selector: selector
        };
        if (status === 'config') configComponents.push(key);
        else if (status === 'fallback') fallbackComponents.push(key);
        else unresolvedComponents.push(key);
      }
    });

    return {
      components: components,
      configComponents: configComponents,
      fallbackComponents: fallbackComponents,
      unresolvedComponents: unresolvedComponents
    };
  }

  async function scrollAndExtract(days, sort, rangeMode, startDate, endDate, tabId) {
    try {
      initializeSelectorDiagnostics();
      var runId = createRunId();
      var startTs = new Date().toISOString();
      var runTabId = tabId || activeTabId || null;
      var list = resolveChatList();
      if (!list) {
        sendMsg({ type: 'error', error: 'No chat pane found. Make sure you have a chat open in Teams.' });
        return;
      }

      // ==========================================
      // PHASE 1: INITIALIZATION & BOUNDARIES
      // ==========================================
      var START_DATE = null;
      var END_DATE = null;
      var needsScroll = false;
      var now = new Date();

      if (rangeMode === 'custom') {
        var customRange = parseLocalDateRange(startDate, endDate);
        if (!customRange) {
          sendMsg({ type: 'error', error: 'Invalid custom date range.' });
          return;
        }
        START_DATE = customRange.start;
        // Extend end date to the absolute end of the target day
        END_DATE = customRange.end;
        needsScroll = true;
      } else {
        needsScroll = days >= 0;
        END_DATE = new Date(now.getTime() + 86400000); // Tomorrow (effectively infinity)
        if (days > 0) {
          START_DATE = new Date(now.getTime() - days * 86400000);
        } else if (days === 0) {
          START_DATE = new Date(0); // Beginning of time
        }
      }

      var collected = [];
      var seenIds = new Set(); // Upgraded from WeakSet to track persistent string IDs
      var currentDomDate = null; // Track running date globally so it doesn't reset between scroll steps

      function getMessageUniqueId(node) {
        var msgBody = queryOne(node, 'messageBody');
        var mId = resolveMessageId(msgBody);
        if (mId) return mId;
        
        // Bulletproof fallback: Stop using Math.random() so we don't infinitely duplicate empty nodes
        var ts = resolveTimestamp(node);
        var content = queryOne(node, 'content');
        var text = content ? content.innerText.substring(0, 30) : '';
        if (ts) return ts.value + '|' + text;
        
        return 'UNKNOWN|' + text; 
      }

      var collect = async function () {
        if (isPauseRequested()) return;
        for (var poll = 0; poll < 4; poll++) {
          var pending = Array.from(list.querySelectorAll('img')).some(function(img) {
            // Ignore avatars, cards, and emojis. Focus only on actual chat media.
            var isNoise = img.className.indexOf('avatar') >= 0 || 
                          (img.alt && img.alt.indexOf('Profile') >= 0) || 
                          img.closest('.fui-Card, [data-tid*="card"]') || 
                          img.hasAttribute('itemtype');
            
            // If it's incomplete or a 1x1 placeholder/broken image, consider it pending
            return !isNoise && (!img.complete || img.naturalWidth <= 1);
          });
          if (!pending) break;
          await sleep(400); // Give Teams time to download the real image
        }
        await waitForImagesToSettle(list, 3000);
        Array.from(list.children).forEach(function (n) {
          // 1. Ignore garbage: If it has no message body and no content, it is a divider or spacer.
          var hasBody = queryOne(n, 'messageBody'); 
          var hasContent = queryOne(n, 'content');
          if (!hasBody && !hasContent) return;

          var id = getMessageUniqueId(n);
          
          // 2. Update our running clock if this specific node has a timestamp
          var resolved = resolveTimestamp(n);
          if (resolved && resolved.date) {
            currentDomDate = resolved.date;
          }

          if (!seenIds.has(id)) {
            seenIds.add(id); // Always mark as seen so we don't re-evaluate it
            
            // 3. Strict Date Filter with Inheritance
            var effectiveDate = resolved ? resolved.date : currentDomDate;
            
            if (effectiveDate && START_DATE && END_DATE) {
              if (effectiveDate < START_DATE || effectiveDate > END_DATE) {
                return; // Out of bounds: ignore and do not collect
              }
            }
            
            collected.push(n.cloneNode(true));
            lastCollected = collected.slice();
          }
        });
      };

      if (needsScroll) {
        var scrollContainer = findScrollContainer(list);
        if (scrollContainer) {
          function getCurrentBounds() {
            var nodes = Array.from(list.children);
            var oldest = null;
            var newest = null;
            for (var i = 0; i < nodes.length; i++) {
              var ts = resolveTimestamp(nodes[i]);
              if (ts && ts.date) {
                if (!oldest || ts.date < oldest) oldest = ts.date;
                if (!newest || ts.date > newest) newest = ts.date;
              }
            }
            return { oldest: oldest, newest: newest };
          }

          // The Core Mathematical Stepping Engine
          async function seekAndCollect(direction, targetDate, isCollectMode) {
            var maxIterations = 500;
            var noChangeCount = 0;
            var domStallCount = 0;       // NEW: Tracks if DOM stops rendering new messages
            var prevBoundaryTime = null; // NEW: Holds the timestamp of the edge message

            for (var i = 0; i < maxIterations; i++) {
              if (isPauseRequested()) { if (isCollectMode) await collect(); break; }
              if (isCollectMode) await collect();
              
              var before = scrollContainer.scrollTop;
              
              if (isPauseRequested()) break;
              if (direction === 'up') {
                scrollContainer.scrollTop -= scrollContainer.clientHeight * 1.5;
              } else {
                scrollContainer.scrollTop += scrollContainer.clientHeight * 1.5;
              }
              
              await sleep(800); // Speed tweak applied
               
              if (isPauseRequested()) { if (isCollectMode) await collect(); break; }
              
              var after = scrollContainer.scrollTop;
              
              // 1. Physical Scrollbar Check
              if (Math.abs(after - before) <= 2) {
                noChangeCount++;
                if (noChangeCount >= 3) break; 
              } else {
                noChangeCount = 0;
              }
              
              var b = getCurrentBounds();
              
              // 2. DOM Stall Check (The Ghost Scroll Failsafe)
              var currentBoundaryTime = direction === 'up' ? (b.oldest ? b.oldest.getTime() : null) : (b.newest ? b.newest.getTime() : null);
              
              if (currentBoundaryTime && currentBoundaryTime === prevBoundaryTime) {
                domStallCount++;
                if (domStallCount >= 5) {
                  if (isCollectMode) await collect(); // Grab the last remaining nodes
                  break; // Rendered DOM hit the absolute start or end
                }
              } else {
                domStallCount = 0;
              }
              prevBoundaryTime = currentBoundaryTime;

              // 3. Target Date Check
              if (direction === 'up' && b.oldest && b.oldest.getTime() <= targetDate.getTime()) {
                if (isCollectMode) await collect();
                break;
              }
              if (direction === 'down' && b.newest && b.newest.getTime() >= targetDate.getTime()) {
                if (isCollectMode) await collect();
                break;
              }
              
              if (isCollectMode) {
                  // UI updated to reflect ONLY valid collected messages
                  sendMsg({ type: 'progress', count: collected.length });
              }
            }
          }

          var b = getCurrentBounds();
          var bOld = b.oldest ? b.oldest.getTime() : 0;
          var bNew = b.newest ? b.newest.getTime() : Date.now();
          var tStart = START_DATE.getTime();
          var tEnd = END_DATE.getTime();

          // ==========================================
          // PHASE 2: THE 6-SCENARIO STATE ROUTER
          // ==========================================
          if (tStart >= bOld && tEnd <= bNew) {
            // Scenario 0: Perfect Fit (Both dates inside DOM)
            await collect();
          } else if (tEnd >= bOld && tEnd <= bNew && tStart < bOld) {
            // Scenario 1: End inside, Start older -> Collect UP
            await seekAndCollect('up', START_DATE, true);
          } else if (tEnd < bOld) {
            // Scenario 2: Both older -> Seek UP to End, Collect UP to Start
            await seekAndCollect('up', END_DATE, false);
            collected = []; seenIds.clear(); currentDomDate = null; 
            await seekAndCollect('up', START_DATE, true);
          } else if (tStart >= bOld && tStart <= bNew && tEnd > bNew) {
            // Scenario 3: Start inside, End younger -> Collect DOWN
            await seekAndCollect('down', END_DATE, true);
          } else if (tStart > bNew) {
            // Scenario 4: Both younger -> Seek DOWN to Start, Collect DOWN to End
            await seekAndCollect('down', START_DATE, false);
            collected = []; seenIds.clear(); currentDomDate = null; 
            await seekAndCollect('down', END_DATE, true);
          } else {
            // Scenario 5: DOM in middle
            if (Math.abs(bNew - tEnd) < Math.abs(bOld - tStart)) {
              // Target End is closer to DOM
              await seekAndCollect('down', END_DATE, false);
              collected = []; seenIds.clear(); currentDomDate = null; 
              await seekAndCollect('up', START_DATE, true);
            } else {
              // Target Start is closer to DOM
              await seekAndCollect('up', START_DATE, false);
              collected = []; seenIds.clear(); currentDomDate = null; 
              await seekAndCollect('down', END_DATE, true);
            }
          }
        }
      } else {
        await collect(); // Currently loaded messages only
      }

      // ==========================================
      // PHASE 3: FINALIZATION & STRICT FILTERING
      // ==========================================
      
      // Upgraded sorter: sorts accurately by Date object, not generic integer parsing
      var filterAndSortCustom = function(nodes) {
        var map = new Map();
        nodes.forEach(function (n) {
          var msg = queryOne(n, 'messageBody');
          if (msg && !queryOne(n, 'animatedGif')) {
            var id = getMessageUniqueId(n);
            if (!map.has(id)) map.set(id, n);
          }
        });
        return Array.from(map.entries())
          .map(function(e) { return e[1]; })
          .sort(function(a, b) {
            var tsA = resolveTimestamp(a);
            var tsB = resolveTimestamp(b);
            var dateA = tsA ? tsA.date.getTime() : 0;
            var dateB = tsB ? tsB.date.getTime() : 0;
            return dateA - dateB;
          });
      };

      var nodes = filterAndSortCustom(collected);
      if (isPauseRequested()) {
        var pausedNodes = filterAndSortNodes(lastCollected || []);
        if (sort === 'newest') pausedNodes.reverse();
        var transcript = buildTranscript(pausedNodes);
        var selectorSummary = buildSelectorDiagnosticsSummary();
        sendMsg({
          type: 'EXTRACTION_PAUSED',
          html: transcript.html,
          rows: transcript.rows,
          count: pausedNodes.length,
          selectorDiagnostics: selectorSummary
        });
        return;
      }

      // Strict boundary chopper to drop excess DOM baggage
      // var filterNodesToRange = function(unfilteredNodes) {
      //   return unfilteredNodes.filter(function (n) {
      //     var resolved = resolveTimestamp(n);
      //     if (!resolved) return true; 
      //     if (START_DATE && END_DATE) {
      //       return resolved.date >= START_DATE && resolved.date <= END_DATE;
      //     }
      //     return true;
      //   });
      // };

      //nodes = filterNodesToRange(nodes);

      // Legacy fallback routine
      if (nodes.length === 0) {
        var origGetConfiguredSelectors = getConfiguredSelectors;
        try {
          getConfiguredSelectors = function () { return []; };
          collected = [];
          seenIds.clear();
          await collect();
          //nodes = filterNodesToRange(filterAndSortCustom(collected));
        } finally {
          getConfiguredSelectors = origGetConfiguredSelectors;
        }
        
        if (nodes.length === 0) {
          sendMsg({ type: 'error', error: 'No messages could be extracted within the requested date range.' });
          return;
        }
      }

      if (sort === 'newest') nodes.reverse();

      var transcript = buildTranscript(nodes);
      var selectorSummary = buildSelectorDiagnosticsSummary();

      var transcriptContainer = document.createElement('div');
      transcriptContainer.innerHTML = transcript.html;
      var capturedImages = await captureImagesAndMarkHtml(transcriptContainer);
      var imageIds = [];
      for (var i = 0; i < capturedImages.length; i += 1) {
        var image = capturedImages[i];
        try {
          await chrome.runtime.sendMessage({
            type: 'extract-image',
            runId: runId,
            tabId: runTabId,
            imageId: image.imageId,
            sourceUrl: image.sourceUrl,
            contentType: image.contentType,
            blobBuffer: image.blobBuffer
          });
          if (image.element) {
            image.element.setAttribute('data-image-id', image.imageId);
            image.element.setAttribute('src', isBlobUrl(image.sourceUrl) ? TRANSPARENT_PIXEL_DATA_URI : image.sourceUrl);
          }
          imageIds.push(image.imageId);
        } catch (e) {
          // Ignore persistence errors so UI still renders.
        }
      }

      var htmlWithPlaceholders = transcriptContainer.innerHTML;
      try {
        var chatName = (typeof extractChatName === 'function') ? extractChatName() : (document.title || '').replace(/\s*-\s*Microsoft Teams\s*$/i, '').trim();
        await chrome.runtime.sendMessage({
          type: 'extract-result',
          runId: runId,
          tabId: runTabId,
          html: htmlWithPlaceholders,
          rows: transcript.rows,
          count: nodes.length,
          selectorDiagnostics: selectorSummary,
          imageIds: imageIds,
          ts: new Date().toISOString(),
          startTs: startTs,
          chatName: chatName
        });
      } catch (e) {
        // Ignore persistence errors so UI still renders.
      }
      
      var chatNameForMsg = (typeof extractChatName === 'function') ? extractChatName() : (document.title || '').replace(/\s*-\s*Microsoft Teams\s*$/i, '').trim();
      sendMsg({
        type: 'result',
        html: htmlWithPlaceholders,
        rows: transcript.rows,
        count: nodes.length,
        selectorDiagnostics: selectorSummary,
        imageIds: imageIds,
        runId: runId,
        chatName: chatNameForMsg
      });
    } catch (e) {
      sendMsg({ type: 'error', error: 'Extraction failed: ' + e.message });
    }
  }

  // Runtime helper: perform a DOM audit of configured selectors and report counts
  function runSelectorAudit() {
    var config = window.TEAMS_SELECTOR_CONFIG && window.TEAMS_SELECTOR_CONFIG.selectors || {};
    var report = {};
    Object.keys(config).forEach(function (key) {
      var entry = config[key] || {};
      var configuredList = normalizeSelectorList(entry.selectors || []);
      var configuredMatches = {};
      configuredList.forEach(function (s) {
        try { configuredMatches[s] = (document.querySelectorAll(s) || []).length; } catch (e) { configuredMatches[s] = 0; }
      });
      var fallbackList = LEGACY_SELECTORS[key] || [];
      var fallbackMatches = {};
      fallbackList.forEach(function (s) {
        try { fallbackMatches[s] = (document.querySelectorAll(s) || []).length; } catch (e) { fallbackMatches[s] = 0; }
      });

      report[key] = {
        config: configuredMatches,
        fallback: fallbackMatches
      };
    });

    sendMsg({ type: 'selector-audit', report: report });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === 'extract') {
      setPauseRequested(false);
      lastCollected = [];
      activeTabId = message.tabId || (sender && sender.tab && sender.tab.id) || activeTabId;
      scrollAndExtract(message.days, message.sort, message.rangeMode, message.startDate, message.endDate, activeTabId);
      sendResponse({ status: 'started' });
      return true;
    }
    if (message.type === 'STOP_EXTRACTION') {
      setPauseRequested(true);
      var nodes = filterAndSortNodes(lastCollected || []);
      var transcript = buildTranscript(nodes);
      var selectorSummary = buildSelectorDiagnosticsSummary();
      sendMsg({
        type: 'EXTRACTION_PAUSED',
        html: transcript.html,
        rows: transcript.rows,
        count: nodes.length,
        selectorDiagnostics: selectorSummary
      });
      sendResponse({ status: 'paused' });
      return true;
    }
    if (message.action === 'auditSelectors') {
      try {
        runSelectorAudit();
        sendResponse({ status: 'audit_started' });
      } catch (e) {
        sendResponse({ status: 'error', error: e.message });
      }
      return true;
    }
    return false;
  });
})();
