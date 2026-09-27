(function () {
  // Centralized Teams selector configuration.
  // Each component exposes a single `selectors` array (order = try order).
  // The legacy runtime fallback is documented in comments only — the code
  // still falls back to LEGACY_SELECTORS when configured selectors fail.
  window.TEAMS_SELECTOR_CONFIG = {
    selectors: {
      // chatList
      // fallback: '#chat-pane-list'
      chatList: {
        selectors: ['[data-tid="message-pane-list-runway"]', '[class^="fui-Chat ___"]']
      },

      // timestamp
      // fallback: '[id^="timestamp-"]'
      timestamp: {
        selectors: ['[class^="fui-ChatMessage__timestamp ___"]']
      },

      // messageBody
      // fallback: '[id^="message-body-"]'
      messageBody: {
        selectors: ['[data-tid="chat-pane-message"]', '[class^="fui-ChatMessage__body"]']
      },

      // content (inner message)
      // fallback: '[id^="message-body-"] [id^="content-"]'
      content: {
        selectors: ['[data-message-content]']
      },

      // animatedGif
      // fallback: '[aria-label="Animated GIF"]'
      animatedGif: {
        selectors: ['[aria-label*="GIF"]', '[aria-label*="GIF Image"]']
      },

      // emojiImage / emoticons
      // fallback: 'img[itemtype*="Emoji"]'
      emojiImage: {
        selectors: []
      },

      // mentionBlock
      // fallback: 'div[aria-label*="Mention"]'
      mentionBlock: {
        selectors: ['*:has(> span[itemtype="http://schema.skype.com/Mention"])', 'div[aria-label^="Mentioned"]']
      },

      // quotedReply
      // fallback: 'div[data-track-module-name="messageQuotedReply"]'
      quotedReply: {
        selectors: ['div[data-track-action-scenario="messageQuotedReplyDeeplink"]', '*:has(>div[data-tid="quoted-reply-card"])']
      },

      // author
      // fallback: '[data-tid="message-author-name"]'
      author: {
        selectors: ['[id^="author-"]']
      }
    }
  };
})();
