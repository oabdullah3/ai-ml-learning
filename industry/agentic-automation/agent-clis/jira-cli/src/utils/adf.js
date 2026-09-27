function toAdf(text) {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: text
          ? [
              {
                type: "text",
                text: String(text),
              },
            ]
          : [],
      },
    ],
  };
}

module.exports = {
  toAdf,
};
