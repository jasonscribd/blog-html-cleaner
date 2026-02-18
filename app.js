const pasteTarget = document.getElementById("pasteTarget");
const sourceHtml = document.getElementById("sourceHtml");
const cleanHtml = document.getElementById("cleanHtml");
const preview = document.getElementById("preview");
const cleanBtn = document.getElementById("cleanBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");

pasteTarget.addEventListener("paste", (event) => {
  const html = event.clipboardData?.getData("text/html");
  const text = event.clipboardData?.getData("text/plain") || "";

  if (!html && !text) {
    return;
  }

  event.preventDefault();

  if (html) {
    sourceHtml.value = html;
    pasteTarget.innerText = text || "Pasted rich text captured.";
  } else {
    sourceHtml.value = textToHtml(text);
    pasteTarget.innerText = text;
  }
});

cleanBtn.addEventListener("click", () => {
  const cleaned = cleanForContentful(sourceHtml.value);
  cleanHtml.value = cleaned;
  preview.innerHTML = cleaned;
});

copyBtn.addEventListener("click", async () => {
  if (!cleanHtml.value.trim()) {
    return;
  }

  await navigator.clipboard.writeText(cleanHtml.value);
  copyBtn.textContent = "Copied";
  setTimeout(() => {
    copyBtn.textContent = "Copy Clean HTML";
  }, 1200);
});

clearBtn.addEventListener("click", () => {
  pasteTarget.innerHTML = "";
  sourceHtml.value = "";
  cleanHtml.value = "";
  preview.innerHTML = "";
});

function cleanForContentful(input) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${input || ""}</body>`, "text/html");
  const root = doc.body;

  removeComments(doc);
  removeTags(root, [
    "script",
    "style",
    "noscript",
    "img",
    "picture",
    "figure",
    "figcaption",
    "svg",
    "video",
    "audio",
    "iframe",
    "canvas",
    "source"
  ]);

  removeExactTextBlocks(root, ["Start Reading", "Start Listening"]);
  normalizeHeadings(root);
  convertBookTitlesToH3(root);
  unwrapTags(root, ["div", "span", "font", "section", "article", "main", "header", "footer", "aside"]);
  stripFormattingTags(root, ["b", "strong", "i", "em", "u"]);
  pruneToAllowedTags(root, ["p", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "br"]);
  normalizeLinks(root);
  stripAttributes(root);
  removeEmptyElements(root);
  collapseExtraBreaks(root);

  return sanitizeOutput(root.innerHTML);
}

function removeComments(doc) {
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const comments = [];
  let node = walker.nextNode();
  while (node) {
    comments.push(node);
    node = walker.nextNode();
  }
  comments.forEach((comment) => comment.remove());
}

function removeTags(root, tags) {
  root.querySelectorAll(tags.join(",")).forEach((el) => el.remove());
}

function removeExactTextBlocks(root, phrases) {
  const phrasePattern = new RegExp(
    `^(${phrases.map((p) => normalizeSpace(p)).join("|")})(?:[:\\-\\s]*)$`,
    "i"
  );
  const blocks = root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote");

  blocks.forEach((el) => {
    const text = normalizeSpace(el.textContent || "");
    if (phrasePattern.test(text)) {
      el.remove();
    }
  });
}

function normalizeHeadings(root) {
  root.querySelectorAll("h4,h5,h6").forEach((heading) => {
    const h3 = root.ownerDocument.createElement("h3");
    h3.innerHTML = heading.innerHTML;
    heading.replaceWith(h3);
  });
}

function convertBookTitlesToH3(root) {
  root.querySelectorAll("p").forEach((p) => {
    const text = normalizeSpace(p.textContent || "");
    if (!text) {
      return;
    }

    const meaningfulChildren = Array.from(p.childNodes).filter((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return normalizeSpace(node.textContent || "") !== "";
      }
      return true;
    });

    const allowedChildNames = new Set(["STRONG", "B", "EM", "I", "A", "BR", "#text"]);
    const onlyAllowedChildren = meaningfulChildren.every((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return true;
      }
      return allowedChildNames.has(node.nodeName);
    });

    const hasStrongMarker = p.querySelector("strong,b,em,i") !== null;
    const isShortTitle = text.length >= 3 && text.length <= 120;
    const noTerminalPunctuation = !/[.!?]$/.test(text);
    const titleLikeWordCount = text.split(/\s+/).length <= 14;

    if (onlyAllowedChildren && hasStrongMarker && isShortTitle && noTerminalPunctuation && titleLikeWordCount) {
      const h3 = root.ownerDocument.createElement("h3");
      h3.innerHTML = p.innerHTML;
      p.replaceWith(h3);
    }
  });
}

function unwrapTags(root, tags) {
  root.querySelectorAll(tags.join(",")).forEach((el) => {
    el.replaceWith(...el.childNodes);
  });
}

function stripFormattingTags(root, tags) {
  root.querySelectorAll(tags.join(",")).forEach((el) => {
    el.replaceWith(...el.childNodes);
  });
}

function pruneToAllowedTags(root, allowedTags) {
  const allowed = new Set(allowedTags.map((tag) => tag.toUpperCase()));
  let changed = true;

  while (changed) {
    changed = false;
    root.querySelectorAll("*").forEach((el) => {
      if (!allowed.has(el.nodeName)) {
        el.replaceWith(...el.childNodes);
        changed = true;
      }
    });
  }
}

function normalizeLinks(root) {
  root.querySelectorAll("a").forEach((link) => {
    const href = (link.getAttribute("href") || "").trim();

    if (!href || href.toLowerCase().startsWith("javascript:")) {
      link.replaceWith(...link.childNodes);
      return;
    }

    const safeHref = href.replace(/\s+/g, "");
    link.setAttribute("href", safeHref);
  });
}

function stripAttributes(root) {
  root.querySelectorAll("*").forEach((el) => {
    if (el.nodeName === "A") {
      const href = el.getAttribute("href");
      const title = el.getAttribute("title");
      Array.from(el.attributes).forEach((attr) => {
        if (attr.name !== "href" && attr.name !== "title") {
          el.removeAttribute(attr.name);
        }
      });
      if (href) {
        el.setAttribute("href", href);
      }
      if (title) {
        el.setAttribute("title", title);
      }
      return;
    }

    Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));
  });
}

function removeEmptyElements(root) {
  let changed = true;
  while (changed) {
    changed = false;
    root.querySelectorAll("*").forEach((el) => {
      if (el.nodeName === "BR") {
        return;
      }

      const hasElementChild = el.children.length > 0;
      const text = normalizeSpace(el.textContent || "");

      if (!hasElementChild && text === "") {
        el.remove();
        changed = true;
      }
    });
  }
}

function collapseExtraBreaks(root) {
  root.querySelectorAll("p,li,h1,h2,h3,blockquote").forEach((el) => {
    let brCount = 0;
    Array.from(el.childNodes).forEach((node) => {
      if (node.nodeName === "BR") {
        brCount += 1;
        if (brCount > 1) {
          node.remove();
        }
      } else if (node.nodeType === Node.TEXT_NODE && normalizeSpace(node.textContent || "") === "") {
      } else {
        brCount = 0;
      }
    });
  });
}

function sanitizeOutput(html) {
  return html
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeSpace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function textToHtml(text) {
  if (!text.trim()) {
    return "";
  }

  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
