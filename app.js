const pasteTarget = document.getElementById("pasteTarget");
const sourceHtml = document.getElementById("sourceHtml");
const cleanHtml = document.getElementById("cleanHtml");
const preview = document.getElementById("preview");
const cleanBtn = document.getElementById("cleanBtn");
const validateLinksBtn = document.getElementById("validateLinksBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const linkStatus = document.getElementById("linkStatus");
const sheetFile = document.getElementById("sheetFile");
const sheetColumn = document.getElementById("sheetColumn");
const cleanSheetBtn = document.getElementById("cleanSheetBtn");
const downloadSheetBtn = document.getElementById("downloadSheetBtn");
const sheetStatus = document.getElementById("sheetStatus");

const START_PROMPTS = ["Start Reading", "Start Listening"];
const DEAD_PAGE_MARKER =
  "The page you are looking for is no longer here, or never existed in the first place (bummer).";
const XLSX_LIBRARY_ERROR = "Spreadsheet support failed to load. Refresh and try again.";

let uploadedSheetRows = [];
let uploadedSheetHeaders = [];
let uploadedSheetName = "cleaned-output";
let processedSheetRows = [];
let processedSheetHeaders = [];

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

sheetFile.addEventListener("change", async (event) => {
  await loadSpreadsheet(event.target.files?.[0] || null);
});

cleanSheetBtn.addEventListener("click", () => {
  cleanSpreadsheetRows();
});

downloadSheetBtn.addEventListener("click", () => {
  downloadProcessedSpreadsheet();
});

downloadSheetBtn.disabled = true;

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

  removePromptContent(root, START_PROMPTS);
  normalizeHeadings(root);
  convertBookListItemsToH3(root);
  convertRankedBookHeadingsToH3(root);
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

async function loadSpreadsheet(file) {
  if (!file) {
    setSheetStatus("Choose a spreadsheet file first.");
    return;
  }

  if (typeof XLSX === "undefined") {
    setSheetStatus(XLSX_LIBRARY_ERROR);
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: "" });

    if (rows.length < 2) {
      setSheetStatus("Spreadsheet has no data rows.");
      return;
    }

    const rawHeaders = rows[0].map((value, index) => {
      const header = normalizeSpace(String(value || ""));
      return header || `Column_${index + 1}`;
    });

    uploadedSheetHeaders = makeUniqueHeaders(rawHeaders);
    uploadedSheetRows = rows.slice(1).map((rowValues) => {
      const rowObject = {};
      uploadedSheetHeaders.forEach((header, index) => {
        rowObject[header] = rowValues[index] === undefined ? "" : String(rowValues[index]);
      });
      return rowObject;
    });

    uploadedSheetName = file.name.replace(/\.[^.]+$/, "") || "cleaned-output";
    processedSheetRows = [];
    processedSheetHeaders = [];
    downloadSheetBtn.disabled = true;
    populateSheetColumnOptions(uploadedSheetHeaders);
    setSheetStatus(`Loaded ${uploadedSheetRows.length} rows from ${file.name}.`);
  } catch {
    setSheetStatus("Could not read that spreadsheet. Try CSV or XLSX.");
  }
}

function makeUniqueHeaders(headers) {
  const seen = new Map();
  return headers.map((header) => {
    const count = seen.get(header) || 0;
    seen.set(header, count + 1);
    return count === 0 ? header : `${header}_${count + 1}`;
  });
}

function populateSheetColumnOptions(headers) {
  sheetColumn.innerHTML = "";
  headers.forEach((header) => {
    const option = document.createElement("option");
    option.value = header;
    option.textContent = header;
    sheetColumn.appendChild(option);
  });
}

function cleanSpreadsheetRows() {
  const selectedColumn = sheetColumn.value;
  if (!selectedColumn) {
    setSheetStatus("Select a column to clean.");
    return;
  }

  if (uploadedSheetRows.length === 0) {
    setSheetStatus("Upload a spreadsheet first.");
    return;
  }

  const cleanedColumn = `${selectedColumn}_cleaned`;
  processedSheetRows = uploadedSheetRows.map((row) => {
    const source = row[selectedColumn] || "";
    return {
      ...row,
      [cleanedColumn]: cleanForContentful(source)
    };
  });

  processedSheetHeaders = [...uploadedSheetHeaders, cleanedColumn];
  downloadSheetBtn.disabled = false;
  setSheetStatus(`Cleaned ${processedSheetRows.length} rows. Ready to download.`);
}

function downloadProcessedSpreadsheet() {
  if (typeof XLSX === "undefined") {
    setSheetStatus(XLSX_LIBRARY_ERROR);
    return;
  }

  if (processedSheetRows.length === 0) {
    setSheetStatus("Clean a spreadsheet first.");
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(processedSheetRows, {
    header: processedSheetHeaders
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Cleaned");
  XLSX.writeFile(workbook, `${uploadedSheetName}-cleaned.xlsx`);
  setSheetStatus("Download created.");
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

  try {
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
      setStatus(`Validation done: removed ${removed} dead-page links, ${unknown} could not be confirmed.`);
    } else {
      setStatus(`Validation done: removed ${removed} dead-page links.`);
    }
  } finally {
    validateLinksBtn.disabled = false;
  }
}

async function checkLinkForDeadPage(url) {
  const href = (url || "").trim();
  if (!href || !/^https?:\/\//i.test(href)) {
    return "unknown";
  }

  const marker = normalizeSpace(DEAD_PAGE_MARKER).toLowerCase();
  const probes = [fetchDirectHtml, fetchAllOriginsHtml, fetchJinaHtml];

  for (const probe of probes) {
    const html = await probe(href);
    if (html === null) {
      continue;
    }

    if (html === "") {
      return "ok";
    }

    const body = normalizeSpace(html.toLowerCase());
    return body.includes(marker) ? "dead" : "ok";
  }

  return "unknown";
}

async function fetchDirectHtml(url) {
  try {
    const response = await fetchWithTimeout(url, { method: "GET", redirect: "follow", mode: "cors" }, 8000);
    if (!response.ok) {
      return null;
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      return "";
    }

    return await response.text();
  } catch {
    return null;
  }
}

async function fetchAllOriginsHtml(url) {
  try {
    const endpoint = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const response = await fetchWithTimeout(endpoint, { method: "GET", mode: "cors" }, 10000);
    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

async function fetchJinaHtml(url) {
  try {
    const endpoint = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
    const response = await fetchWithTimeout(endpoint, { method: "GET", mode: "cors" }, 10000);
    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildPromptTokens(phrases) {
  return phrases.map((phrase) => normalizePromptToken(phrase)).filter(Boolean);
}

function normalizePromptToken(text) {
  return (text || "").toLowerCase().replace(/[^a-z]/g, "");
}

function hasPromptText(text, promptTokens) {
  const normalized = normalizePromptToken(text);
  if (!normalized) {
    return false;
  }

  return promptTokens.some((token) => normalized.includes(token));
}

function removePromptContent(root, phrases) {
  const promptTokens = buildPromptTokens(phrases);

  root.querySelectorAll("a").forEach((link) => {
    if (hasPromptText(link.textContent || "", promptTokens)) {
      link.remove();
    }
  });

  root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote").forEach((el) => {
    if (hasPromptText(el.textContent || "", promptTokens)) {
      el.remove();
    }
  });

  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node = walker.nextNode();
  while (node) {
    if (hasPromptText(node.textContent || "", promptTokens)) {
      textNodes.push(node);
    }
    node = walker.nextNode();
  }
  textNodes.forEach((textNode) => textNode.remove());

  root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote").forEach((el) => {
    if (!normalizeSpace(el.textContent || "")) {
      el.remove();
    }
  });
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

function convertRankedBookHeadingsToH3(root) {
  const doc = root.ownerDocument;

  root.querySelectorAll("h1,h2,h3").forEach((heading) => {
    const text = normalizeSpace(heading.textContent || "");
    const rankedMatch = text.match(/^(\d+)\.\s+(.+)$/);
    if (!rankedMatch) {
      return;
    }

    const prefix = `${rankedMatch[1]}. `;
    const remainder = rankedMatch[2];
    const { title, suffix } = splitTitleAndSuffix(remainder);

    const h3 = doc.createElement("h3");
    h3.appendChild(doc.createTextNode(prefix));
    appendItalicizedTitle(h3, heading, title, suffix, doc);
    heading.replaceWith(h3);
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

  return (
    Array.from(node.querySelectorAll("a")).find((a) => {
      const text = normalizeSpace(a.textContent || "").toLowerCase();
      return text === normalizedTitle;
    }) || null
  );
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
  return html.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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

function setSheetStatus(message) {
  sheetStatus.textContent = message;
}
