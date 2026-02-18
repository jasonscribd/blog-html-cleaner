const pasteTarget = document.getElementById("pasteTarget");
const sourceHtml = document.getElementById("sourceHtml");
const cleanHtml = document.getElementById("cleanHtml");
const preview = document.getElementById("preview");
const cleanBtn = document.getElementById("cleanBtn");
const validateLinksBtn = document.getElementById("validateLinksBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const linkStatus = document.getElementById("linkStatus");

const START_PROMPTS = ["Start Reading", "Start Listening"];
const DEAD_PAGE_MARKER =
  "The page you are looking for is no longer here, or never existed in the first place (bummer).";

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
  setStatus("Clean complete.");
});

validateLinksBtn.addEventListener("click", async () => {
  await validateLinksInOutput();
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
  setStatus("");
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

  removeLinkedPromptText(root, START_PROMPTS);
  removeExactTextBlocks(root, START_PROMPTS);
  normalizeHeadings(root);
  convertBookListItemsToH3(root);
  convertBookTitlesToH3(root);
  unwrapTags(root, ["div", "span", "font", "section", "article", "main", "header", "footer", "aside"]);
  normalizeItalics(root);
  stripFormattingTags(root, ["b", "strong", "u"]);
  pruneToAllowedTags(root, ["p", "h1", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "br", "em"]);
  normalizeLinks(root);
  stripAttributes(root);
  removeEmptyElements(root);
  collapseExtraBreaks(root);

  return sanitizeOutput(root.innerHTML);
}

async function validateLinksInOutput() {
  const current = cleanHtml.value.trim();
  if (!current) {
    setStatus("Clean HTML first, then run link validation.");
    return;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${current}</body>`, "text/html");
  const root = doc.body;
  const links = Array.from(root.querySelectorAll("a[href]"));

  if (links.length === 0) {
    setStatus("No links found to validate.");
    return;
  }

  validateLinksBtn.disabled = true;
  let removed = 0;
  let unknown = 0;

  setStatus(`Validating ${links.length} links (best effort)...`);

  for (const link of links) {
    const result = await checkLinkForDeadPage(link.getAttribute("href") || "");
    if (result === "dead") {
      link.replaceWith(...link.childNodes);
      removed += 1;
    } else if (result === "unknown") {
      unknown += 1;
    }
  }

  cleanHtml.value = sanitizeOutput(root.innerHTML);
  preview.innerHTML = cleanHtml.value;

  if (unknown > 0) {
    setStatus(`Validation done: removed ${removed} dead-page links, ${unknown} could not be checked (likely CORS blocked).`);
  } else {
    setStatus(`Validation done: removed ${removed} dead-page links.`);
  }

  validateLinksBtn.disabled = false;
}

async function checkLinkForDeadPage(url) {
  const href = (url || "").trim();
  if (!href) {
    return "unknown";
  }

  try {
    const response = await fetch(href, { method: "GET", redirect: "follow", mode: "cors" });
    if (!response.ok) {
      return "unknown";
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      return "ok";
    }

    const body = normalizeSpace((await response.text()).toLowerCase());
    const marker = normalizeSpace(DEAD_PAGE_MARKER).toLowerCase();

    return body.includes(marker) ? "dead" : "ok";
  } catch {
    return "unknown";
  }
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

function removeLinkedPromptText(root, phrases) {
  const promptPattern = buildPromptPattern(phrases);
  root.querySelectorAll("a").forEach((link) => {
    const text = normalizeSpace(link.textContent || "");
    if (promptPattern.test(text)) {
      link.remove();
    }
  });
}

function removeExactTextBlocks(root, phrases) {
  const phrasePattern = buildPromptPattern(phrases);
  const blocks = root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote");

  blocks.forEach((el) => {
    const text = normalizeSpace(el.textContent || "");
    if (phrasePattern.test(text)) {
      el.remove();
    }
  });
}

function buildPromptPattern(phrases) {
  const escaped = phrases.map((phrase) => normalizeSpace(phrase).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(?:${escaped.join("|")})(?:[:\\-\\s]*)$`, "i");
}

function normalizeHeadings(root) {
  root.querySelectorAll("h4,h5,h6").forEach((heading) => {
    const h3 = root.ownerDocument.createElement("h3");
    h3.innerHTML = heading.innerHTML;
    heading.replaceWith(h3);
  });
}

function convertBookListItemsToH3(root) {
  const doc = root.ownerDocument;

  root.querySelectorAll("ul,ol").forEach((list) => {
    const items = Array.from(list.querySelectorAll(":scope > li"));

    items.forEach((li) => {
      const text = normalizeSpace(li.textContent || "");
      if (!text) {
        li.remove();
        return;
      }

      const { title, suffix } = splitTitleAndSuffix(text);
      const h3 = doc.createElement("h3");
      appendItalicizedTitle(h3, li, title, suffix, doc);
      li.replaceWith(h3);
    });

    list.remove();
  });
}

function convertBookTitlesToH3(root) {
  const doc = root.ownerDocument;

  root.querySelectorAll("p").forEach((p) => {
    const text = normalizeSpace(p.textContent || "");
    if (!text) {
      return;
    }

    const hasStyleMarker = p.querySelector("strong,b,em,i") !== null;
    const isShortTitle = text.length >= 3 && text.length <= 160;
    const noTerminalPunctuation = !/[.!?]$/.test(text);
    const titleLikeWordCount = text.split(/\s+/).length <= 20;

    if (!hasStyleMarker || !isShortTitle || !noTerminalPunctuation || !titleLikeWordCount) {
      return;
    }

    const { title, suffix } = splitTitleAndSuffix(text);
    const h3 = doc.createElement("h3");
    appendItalicizedTitle(h3, p, title, suffix, doc);
    p.replaceWith(h3);
  });
}

function splitTitleAndSuffix(text) {
  const normalized = normalizeSpace(text);
  const byMatch = normalized.match(/^(.*?)(\s+by\s+.+)$/i);

  if (byMatch && normalizeSpace(byMatch[1])) {
    return {
      title: normalizeSpace(byMatch[1]),
      suffix: byMatch[2]
    };
  }

  return {
    title: normalized,
    suffix: ""
  };
}

function appendItalicizedTitle(target, sourceNode, title, suffix, doc) {
  const em = doc.createElement("em");
  const linkedTitle = findTitleAnchor(sourceNode, title);

  if (linkedTitle) {
    const a = doc.createElement("a");
    const href = (linkedTitle.getAttribute("href") || "").trim();
    if (href) {
      a.setAttribute("href", href);
    }
    const titleAttr = linkedTitle.getAttribute("title");
    if (titleAttr) {
      a.setAttribute("title", titleAttr);
    }
    a.textContent = title;
    em.appendChild(a);
  } else {
    em.textContent = title;
  }

  target.appendChild(em);

  if (suffix) {
    target.appendChild(doc.createTextNode(suffix));
  }
}

function findTitleAnchor(node, title) {
  const normalizedTitle = normalizeSpace(title).toLowerCase();
  if (!normalizedTitle) {
    return null;
  }

  return Array.from(node.querySelectorAll("a")).find((a) => {
    const text = normalizeSpace(a.textContent || "").toLowerCase();
    return text === normalizedTitle;
  }) || null;
}

function unwrapTags(root, tags) {
  root.querySelectorAll(tags.join(",")).forEach((el) => {
    el.replaceWith(...el.childNodes);
  });
}

function normalizeItalics(root) {
  root.querySelectorAll("i").forEach((node) => {
    const em = root.ownerDocument.createElement("em");
    em.innerHTML = node.innerHTML;
    node.replaceWith(em);
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

function setStatus(message) {
  linkStatus.textContent = message;
}
