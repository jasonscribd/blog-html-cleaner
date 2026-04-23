// Blog HTML Cleaner — New Posts page
// Takes a Google Doc exported as .docx plus an image ZIP and produces the same
// Contentful-ready outputs as the Everand-sourced flow on index.html.

// ---------- DOM bindings ----------
const docxFileInput = document.getElementById("docxFile");
const docxStatus = document.getElementById("docxStatus");
const imageZipInput = document.getElementById("imageZip");
const zipStatus = document.getElementById("zipStatus");
const parseBtn = document.getElementById("parseBtn");
const validateLinksBtn = document.getElementById("validateLinksBtn");
const downloadZipBtn = document.getElementById("downloadZipBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const linkStatus = document.getElementById("linkStatus");
const preview = document.getElementById("preview");
const seoTitle = document.getElementById("seoTitle");
const seoDescription = document.getElementById("seoDescription");
const seoTitleRepeat = document.getElementById("seoTitleRepeat");
const seoDescriptionRepeat = document.getElementById("seoDescriptionRepeat");
const postSlug = document.getElementById("postSlug");
const validatedLinks = document.getElementById("validatedLinks");

let currentCleanHtml = "";

// ---------- Event wiring ----------
if (docxFileInput) {
  docxFileInput.addEventListener("change", () => {
    const file = docxFileInput.files && docxFileInput.files[0];
    setDocxStatus(file ? `Loaded: ${file.name}` : "In Google Docs: File → Download → Microsoft Word (.docx), then drop the file here.");
  });
}

parseBtn.addEventListener("click", async () => {
  const docxFile = docxFileInput && docxFileInput.files && docxFileInput.files[0];
  if (!docxFile) {
    setStatus("Upload a .docx first.");
    return;
  }
  if (typeof window.mammoth === "undefined") {
    setStatus("DOCX support failed to load. Refresh and try again.");
    return;
  }
  try {
    setStatus("Reading DOCX...");
    const { fields, bodyHtml } = await parseDocxFile(docxFile);
    renderParsed(fields, bodyHtml);
    setStatus("Parsed and cleaned. Ready for link validation.");
  } catch (err) {
    setStatus("Error reading DOCX: " + (err && err.message ? err.message : "unknown error"));
  }
});

function renderParsed(fields, cleanedHtml) {
  currentCleanHtml = cleanedHtml;
  preview.innerHTML = cleanedHtml;
  seoTitle.value = fields.title || "";
  seoTitleRepeat.value = fields.title || "";
  seoDescription.value = fields.excerpt || "";
  seoDescriptionRepeat.value = fields.excerpt || "";
  postSlug.value = fields.slug || "";
  validatedLinks.value = "";
}

validateLinksBtn.addEventListener("click", async () => {
  await validateLinksInOutput();
});

downloadZipBtn.addEventListener("click", async () => {
  await downloadResizedZip();
});

copyBtn.addEventListener("click", async () => {
  const html = sanitizeOutput(preview.innerHTML || "");
  if (!html) return;
  await navigator.clipboard.writeText(html);
  copyBtn.textContent = "Copied";
  setTimeout(() => { copyBtn.textContent = "Copy Body HTML"; }, 1200);
});

clearBtn.addEventListener("click", () => {
  if (docxFileInput) docxFileInput.value = "";
  imageZipInput.value = "";
  currentCleanHtml = "";
  preview.innerHTML = "";
  seoTitle.value = "";
  seoTitleRepeat.value = "";
  seoDescription.value = "";
  seoDescriptionRepeat.value = "";
  postSlug.value = "";
  validatedLinks.value = "";
  setStatus("");
  setZipStatus("");
  setDocxStatus("In Google Docs: File → Download → Microsoft Word (.docx), then drop the file here.");
});

// ---------- Sentence case for the Title field ----------
// Fable.co's blog uses sentence case in post titles. Writers draft in title case, so we
// lowercase the prose but preserve the case of any italic/bold runs (writers italicize
// proper nouns like "The Lord of the Rings"), then uppercase the first letter.
function sentenceCaseFromElement(el) {
  if (!el) return "";
  const parts = [];
  let firstLetterSet = false;
  const PRESERVE_SEL = "em, strong, i, b";

  function walk(node) {
    if (node.nodeType === 3) {
      let text = node.textContent || "";
      const preserveCase = !!(node.parentElement && node.parentElement.closest(PRESERVE_SEL));
      if (!preserveCase) text = text.toLowerCase();
      if (!firstLetterSet) {
        const idx = text.search(/\S/);
        if (idx >= 0) {
          if (!preserveCase) {
            text = text.slice(0, idx) + text[idx].toUpperCase() + text.slice(idx + 1);
          }
          firstLetterSet = true;
        }
      }
      parts.push(text);
    } else if (node.nodeType === 1) {
      Array.from(node.childNodes).forEach(walk);
    }
  }

  Array.from(el.childNodes).forEach(walk);
  return parts.join("").replace(/\s+/g, " ").trim();
}

// ---------- DOCX parsing (primary input — preserves hyperlinks) ----------
async function parseDocxFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.convertToHtml({ arrayBuffer });
  const html = result && result.value ? result.value : "";
  if (!html) throw new Error("Empty DOCX conversion result");
  return docxHtmlToFieldsAndBody(html);
}

// Takes mammoth's HTML output for a draft doc and returns { fields, bodyHtml }.
// The draft template starts with a 2-column table of header fields
// (Headline/page title, Meta description/subhead, URL, Written by, Keywords, Backlink
// opportunities). The body follows the header table.
function docxHtmlToFieldsAndBody(rawHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${rawHtml || ""}</body>`, "text/html");
  const root = doc.body;

  const fields = { title: "", excerpt: "", slug: "", author: "" };

  const LABEL_MATCHERS = [
    { key: "title",   match: /headline\s*[\/\s]\s*page\s*title/i },
    { key: "excerpt", match: /meta\s*description\s*[\/\s]\s*subhead/i },
    { key: "slug",    match: /^\s*url\s*$/i },
    { key: "author",  match: /written\s+by/i },
  ];
  const INSTRUCTION = /^\s*~?\s*\d+\s*characters?(\s*(max|or\s*less))?\s*$/i;

  // Header table: iterate every row of every table, read label cell 1 vs value cell 2.
  // mammoth puts the first row into <thead><tr><th>...</th></tr></thead>, subsequent rows
  // into <tbody><tr><td>...</td></tr></tbody>. querySelectorAll("tr") covers both.
  const headerTables = Array.from(root.querySelectorAll("table"));
  for (const table of headerTables) {
    const rows = Array.from(table.querySelectorAll("tr"));
    for (const row of rows) {
      const cells = Array.from(row.children).filter(
        (c) => c.tagName === "TD" || c.tagName === "TH"
      );
      if (cells.length < 2) continue;

      const labelText = normalizeSpace(cells[0].textContent || "");
      if (!labelText) continue;

      // Try each value-field label (keywords/backlinks ignored — they're not Contentful fields).
      for (const { key, match } of LABEL_MATCHERS) {
        if (!match.test(labelText)) continue;

        // The value cell contains one or more <p>. Skip instruction lines like "~60 characters".
        // For the title field, apply sentence case while preserving italic/bold runs.
        const valueCell = cells[1];
        const paragraphs = Array.from(valueCell.querySelectorAll("p"));
        let value = "";
        if (paragraphs.length) {
          for (const p of paragraphs) {
            const t = normalizeSpace(p.textContent || "");
            if (!t) continue;
            if (INSTRUCTION.test(t)) continue;
            value = key === "title" ? sentenceCaseFromElement(p) : t;
            break;
          }
        } else {
          value = key === "title"
            ? sentenceCaseFromElement(valueCell)
            : normalizeSpace(valueCell.textContent || "");
        }

        if (value && !fields[key]) fields[key] = value;
        break;
      }
    }
  }

  // Strip slashes around the slug (writers type "/books-like-lord-of-the-rings/").
  fields.slug = (fields.slug || "").replace(/^\s*\/*|\/*\s*$/g, "");

  // Remove all tables from the body — they're the header, not content.
  headerTables.forEach((t) => t.remove());

  // Drop "Source: Everand" and "[Alt text: ...]" paragraphs wherever they appear.
  Array.from(root.querySelectorAll("p")).forEach((p) => {
    const text = normalizeSpace(p.textContent || "");
    if (!text) return;
    if (/^source\s*:/i.test(text)) { p.remove(); return; }
    if (/^\[\s*alt\s*text\s*:/i.test(text)) { p.remove(); return; }
  });

  // Remove embedded images (writers re-upload images directly in Contentful).
  Array.from(root.querySelectorAll("img")).forEach((img) => img.remove());

  // mammoth emits h4 for the "Why LotR fans will love..." subsections. pruneToAllowedTags
  // would unwrap h4, losing the heading. Promote h4/h5/h6 to h3 first.
  ["h4", "h5", "h6"].forEach((tag) => {
    Array.from(root.querySelectorAll(tag)).forEach((el) => {
      const h3 = doc.createElement("h3");
      while (el.firstChild) h3.appendChild(el.firstChild);
      el.replaceWith(h3);
    });
  });

  // Drop mammoth's empty bookmark anchors: <a id="_abc"></a> with no href and no content.
  Array.from(root.querySelectorAll("a")).forEach((a) => {
    if (!a.hasAttribute("href") && !normalizeSpace(a.textContent || "") && a.children.length === 0) {
      a.remove();
    }
  });

  // Re-number the book-title h3s. Google Docs auto-numbering renders as display-only
  // styling, so mammoth loses the "1.", "2.", etc. — book h3s have a hyperlink, "Why LotR
  // fans will love…" subheads don't.
  renumberBookHeadings(root);

  const rawBodyHtml = root.innerHTML;
  const bodyHtml = cleanForContentful(rawBodyHtml);
  return { fields, bodyHtml };
}

// Walk h3 elements in order. Any h3 that contains an <a href> and doesn't start with
// "Why " is treated as a numbered book heading: strip any existing "N. " prefix and
// prepend the correct number.
function renumberBookHeadings(root) {
  const h3s = Array.from(root.querySelectorAll("h3"));
  let n = 0;
  for (const h3 of h3s) {
    const text = normalizeSpace(h3.textContent || "");
    const isWhy = /^why\s/i.test(text);
    const hasLink = !!h3.querySelector("a[href]");
    if (isWhy || !hasLink) continue;
    n++;
    stripLeadingNumberPrefix(h3);
    h3.insertBefore(h3.ownerDocument.createTextNode(`${n}. `), h3.firstChild);
  }
}

// Remove a leading "N. " (or "N.") from the first text content of an element, walking
// past empty text nodes. Stops on the first non-whitespace match or on the first element.
function stripLeadingNumberPrefix(el) {
  let node = el.firstChild;
  while (node) {
    if (node.nodeType === 3) {
      const t = node.textContent || "";
      const match = t.match(/^(\s*\d+\.\s*)/);
      if (match) { node.textContent = t.slice(match[0].length); return; }
      if (t.trim()) return;
    } else if (node.nodeType === 1) {
      return;
    }
    node = node.nextSibling;
  }
}

// ---------- Clean-for-Contentful pipeline (mirrors app.js for the Everand flow) ----------
function cleanForContentful(input) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${input || ""}</body>`, "text/html");
  const root = doc.body;

  removeComments(doc);
  // h1 is dropped entirely — Contentful's rich-text field for Body rejects h1, and the
  // page title already lives in the separate Title/SEO Title fields.
  removeTags(root, [
    "script", "style", "noscript", "img", "picture", "figure", "figcaption",
    "svg", "video", "audio", "iframe", "canvas", "source", "h1"
  ]);
  unwrapTags(root, ["div", "span", "font", "section", "article", "main", "header", "footer", "aside"]);
  stripFormattingTags(root, ["b", "strong", "u"]);
  pruneToAllowedTags(root, ["p", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "br", "em"]);
  normalizeLinks(root);
  stripAttributes(root);
  removeEmptyElements(root);
  collapseExtraBreaks(root);

  return fixAnchorSpacing(sanitizeOutput(root.innerHTML));
}

// When the source doc omits a space between a link and the following word — e.g.
// "<a>The Earthsea Cycle</a>by Ursula K. Le Guin" — insert one so the rendered output
// doesn't crash letters together.
function fixAnchorSpacing(html) {
  return (html || "").replace(/<\/a>([A-Za-z])/g, "</a> $1");
}

function removeComments(doc) {
  const iter = doc.createNodeIterator(doc, NodeFilter.SHOW_COMMENT);
  const toRemove = [];
  let node;
  while ((node = iter.nextNode())) toRemove.push(node);
  toRemove.forEach((n) => n.parentNode && n.parentNode.removeChild(n));
}

function removeTags(root, tags) {
  tags.forEach((tag) => root.querySelectorAll(tag).forEach((el) => el.remove()));
}

function unwrapTags(root, tags) {
  tags.forEach((tag) => {
    root.querySelectorAll(tag).forEach((el) => {
      while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
      el.remove();
    });
  });
}

function stripFormattingTags(root, tags) {
  tags.forEach((tag) => {
    root.querySelectorAll(tag).forEach((el) => {
      while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
      el.remove();
    });
  });
}

function pruneToAllowedTags(root, allowed) {
  const allowedSet = new Set(allowed.map((t) => t.toLowerCase()));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const doomed = [];
  let node;
  while ((node = walker.nextNode())) {
    if (!allowedSet.has(node.tagName.toLowerCase())) doomed.push(node);
  }
  doomed.forEach((el) => {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
}

function normalizeLinks(root) {
  root.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!href) { while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a); a.remove(); return; }
    // External http(s) links → open in new tab with safe rel.
    if (/^https?:\/\//i.test(href)) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  });
}

function stripAttributes(root) {
  const keepByTag = { a: ["href", "target", "rel"] };
  root.querySelectorAll("*").forEach((el) => {
    const allow = keepByTag[el.tagName.toLowerCase()] || [];
    Array.from(el.attributes).forEach((attr) => {
      if (!allow.includes(attr.name)) el.removeAttribute(attr.name);
    });
  });
}

function removeEmptyElements(root) {
  let removedAny = true;
  while (removedAny) {
    removedAny = false;
    root.querySelectorAll("p, li, em, h1, h2, h3, blockquote").forEach((el) => {
      if (el.querySelector("br")) return;
      if (!normalizeSpace(el.textContent || "") && el.children.length === 0) {
        el.remove();
        removedAny = true;
      }
    });
  }
}

function collapseExtraBreaks(root) {
  root.querySelectorAll("br + br").forEach((br) => br.remove());
}

function sanitizeOutput(html) {
  return (html || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- Link validation (ported from app.js) ----------
const DEAD_PAGE_MARKER =
  "The page you are looking for is no longer here, or never existed in the first place (bummer).";

async function validateLinksInOutput() {
  const current = (currentCleanHtml || "").trim();
  if (!current) {
    setStatus("Run Parse & Clean first, then validate links.");
    return;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${current}</body>`, "text/html");
  const root = doc.body;
  const links = Array.from(root.querySelectorAll("a[href]"));

  if (links.length === 0) {
    validatedLinks.value = "";
    setStatus("No links in the cleaned body to validate.");
    return;
  }

  validateLinksBtn.disabled = true;
  const okLinks = [];
  const removedLinks = [];
  const unconfirmedLinks = [];

  setStatus(`Validating ${links.length} link${links.length === 1 ? "" : "s"} (best effort)...`);

  try {
    let checked = 0;
    const results = await processInBatches(links, 5, async (link) => {
      const href = link.getAttribute("href") || "";
      const result = await checkLinkForDeadPage(href);
      checked++;
      setStatus(`Validating links: ${checked}/${links.length} checked...`);
      return { link, href, result };
    });

    let removedDead = 0;
    for (const { link, href, result } of results) {
      if (result === "dead") {
        link.replaceWith(...link.childNodes);
        removedDead += 1;
        removedLinks.push(href);
      } else if (result === "unknown") {
        unconfirmedLinks.push(href);
      } else if (result === "ok") {
        okLinks.push(href);
      }
    }

    currentCleanHtml = sanitizeOutput(root.innerHTML);
    preview.innerHTML = currentCleanHtml;
    validatedLinks.value = formatValidatedLinksByType(okLinks, removedLinks, unconfirmedLinks);

    const parts = [`removed ${removedDead} dead link${removedDead !== 1 ? "s" : ""}`];
    if (unconfirmedLinks.length > 0) parts.push(`${unconfirmedLinks.length} unconfirmed (kept)`);
    setStatus(`Validation done: ${parts.join(", ")}.`);
  } finally {
    validateLinksBtn.disabled = false;
  }
}

async function checkLinkForDeadPage(url) {
  const href = (url || "").trim();
  if (!href || !/^https?:\/\//i.test(href)) return "unknown";

  const settled = await Promise.allSettled([
    fetchDirectProbe(href),
    fetchAllOriginsProbe(href),
    fetchJinaProbe(href),
  ]);

  let sawOk = false;
  let sawDead = false;
  for (const entry of settled) {
    const result = entry.status === "fulfilled" ? entry.value : null;
    if (!result) continue;

    if (result.status === 404 || result.status === 410) { sawDead = true; continue; }
    if (result.nonHtml) {
      if (result.status >= 200 && result.status < 400) sawOk = true;
      continue;
    }
    const body = normalizeSpace((result.body || "").toLowerCase());
    if (!body) continue;
    if (isDeadPageBody(body)) return "dead";
    if (isChallengePageBody(body)) {
      if (result.status >= 200 && result.status < 400) sawOk = true;
      continue;
    }
    if (result.status >= 200 && result.status < 400) sawOk = true;
  }

  return sawOk ? "ok" : sawDead ? "dead" : "unknown";
}

function isDeadPageBody(body) {
  const markers = [
    normalizeSpace(DEAD_PAGE_MARKER).toLowerCase(),
    "page not found - everand blog",
    "page not found",
    "status code: 404",
    "http/2 404",
    "no longer here",
    "never existed in the first place",
    "always start over from the home page",
  ];
  return markers.some((m) => body.includes(m));
}

function isChallengePageBody(body) {
  const markers = ["client challenge", "just a moment", "cf-challenge", "captcha", "access denied", "security check"];
  return markers.some((m) => body.includes(m));
}

async function fetchDirectProbe(url) {
  try {
    const response = await fetchWithTimeout(url, { method: "GET", redirect: "follow", mode: "cors" }, 8000);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const nonHtml = !contentType.includes("text/html");
    const body = nonHtml ? "" : await response.text();
    return { status: response.status || 0, nonHtml, body };
  } catch { return null; }
}

async function fetchAllOriginsProbe(url) {
  try {
    const endpoint = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const response = await fetchWithTimeout(endpoint, { method: "GET", mode: "cors" }, 10000);
    if (!response.ok) return null;
    const json = await response.json();
    return { status: json?.status?.http_code || 0, nonHtml: false, body: json?.contents || "" };
  } catch { return null; }
}

async function fetchJinaProbe(url) {
  try {
    const endpoint = `https://r.jina.ai/${url}`;
    const response = await fetchWithTimeout(endpoint, { method: "GET", mode: "cors" }, 10000);
    const body = await response.text();
    return { status: response.status || 0, nonHtml: false, body };
  } catch { return null; }
}

function formatValidatedLinksByType(urls, removedUrls = [], unconfirmedUrls = []) {
  const validUrl = (url) => /^https?:\/\//i.test(normalizeSpace(url));

  const liveBlogLinks = uniqueUrls(
    urls.map((u) => normalizeSpace(u)).filter(validUrl).filter((u) => linkTypeForUrl(u) === "Blog Links")
  );
  const uniqueRemoved = uniqueUrls(removedUrls.map((u) => normalizeSpace(u)).filter(validUrl));
  const uniqueUnconfirmed = uniqueUrls(unconfirmedUrls.map((u) => normalizeSpace(u)).filter(validUrl));

  if (!liveBlogLinks.length && !uniqueRemoved.length && !uniqueUnconfirmed.length) return "";

  const out = [];
  if (liveBlogLinks.length) {
    out.push("Live Blog Links (update these on the new blog):");
    out.push(liveBlogLinks.join("\n"));
  }
  if (uniqueUnconfirmed.length) {
    out.push("Unconfirmed Links (kept — could not verify, please spot-check):");
    out.push(uniqueUnconfirmed.join("\n"));
  }
  if (uniqueRemoved.length) {
    out.push("Removed Links:");
    out.push(uniqueRemoved.join("\n"));
  }
  return out.join("\n\n");
}

function linkTypeForUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.startsWith("/blog/")) return "Blog Links";
    if (path.startsWith("/audiobook/") || path.startsWith("/book/") ||
        path.startsWith("/ebook/") || path.startsWith("/series/")) return "Book Links";
  } catch {
    return "Other Links";
  }
  return "Other Links";
}

function uniqueUrls(urls) {
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    const n = normalizeSpace(url);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    result.push(n);
  }
  return result;
}

// ---------- ZIP in → resized ZIP out ----------
async function downloadResizedZip() {
  const file = imageZipInput.files && imageZipInput.files[0];
  if (!file) { setZipStatus("Upload the image ZIP first."); return; }

  if (typeof JSZip === "undefined") { setZipStatus("ZIP support failed to load. Refresh and try again."); return; }

  downloadZipBtn.disabled = true;
  setZipStatus("Reading ZIP...");

  try {
    const inputZip = await JSZip.loadAsync(file);
    const outputZip = new JSZip();

    // Collect image entries. Only keep files from article_headers/ and cover_thumbnails/;
    // skip hidden files, masters in 00_resources/, and anything that isn't an image.
    const INCLUDE_FOLDER = /(^|\/)(article[ _-]headers?|cover[ _-]thumbnails?)\//i;
    const entries = [];
    inputZip.forEach((path, entry) => {
      if (entry.dir) return;
      const basename = (path.split("/").pop() || "");
      if (basename.startsWith(".")) return;
      if (!/\.(jpe?g|png|gif|webp)$/i.test(basename)) return;
      if (!INCLUDE_FOLDER.test(path)) return;
      entries.push({ path, entry, basename });
    });

    if (!entries.length) {
      setZipStatus("No images found in article_headers/ or cover_thumbnails/ inside the ZIP.");
      return;
    }

    let processed = 0;
    let added = 0;
    const failed = [];

    for (const { path, entry, basename } of entries) {
      processed++;
      setZipStatus(`Processing ${processed}/${entries.length}: ${basename}`);

      const blob = await entry.async("blob");
      const isHeader = /(^|\/)article_headers\//i.test(path);

      let finalBlob = blob;
      if (!isHeader) {
        const resized = await resizeImageBlobToWidth(blob, 300);
        if (!resized) { failed.push(basename); continue; }
        finalBlob = resized;
      }

      // Mirror the input folder structure (minus any top-level wrapper folder).
      const outputPath = stripTopFolder(path);
      outputZip.file(outputPath, finalBlob);
      added++;
    }

    if (!added) { setZipStatus("Could not process any images from the ZIP."); return; }

    const zipBlob = await outputZip.generateAsync({ type: "blob" });
    const titleHint = (seoTitle.value || postSlug.value || file.name.replace(/\.zip$/i, "")).trim();
    const zipName = `${slugifyFilename(titleHint || "post-images")}-images.zip`;
    triggerDownload(zipBlob, zipName);

    const suffix = failed.length ? ` (${failed.length} could not be processed)` : "";
    setZipStatus(`Downloaded ${added} images${suffix}.`);
  } catch (err) {
    setZipStatus("Error reading ZIP: " + (err && err.message ? err.message : "unknown error"));
  } finally {
    downloadZipBtn.disabled = false;
  }
}

function stripTopFolder(path) {
  const parts = path.split("/");
  if (parts.length <= 1) return path;
  return parts.slice(1).join("/");
}

async function resizeImageBlobToWidth(blob, targetWidth) {
  try {
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width || 0;
    const height = bitmap.height || 0;
    if (width <= 0 || height <= 0) { bitmap.close(); return null; }

    const scale = targetWidth / width;
    const outputWidth = Math.max(1, Math.round(targetWidth));
    const outputHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bitmap.close(); return null; }

    ctx.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
    bitmap.close();

    const outType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), outType, 0.9));
  } catch {
    return null;
  }
}

function slugifyFilename(text) {
  const clean = normalizeSpace(String(text || "file"))
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return clean || "file";
}

function extensionFromBlobType(type) {
  const n = (type || "").toLowerCase();
  if (n.includes("png")) return "png";
  if (n.includes("webp")) return "webp";
  if (n.includes("gif")) return "gif";
  if (n.includes("jpeg") || n.includes("jpg")) return "jpg";
  return "jpg";
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------- Small utilities ----------
function normalizeSpace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function processInBatches(items, batchSize, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(batchSize, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

function setStatus(msg) { if (linkStatus) linkStatus.textContent = msg || ""; }
function setZipStatus(msg) { if (zipStatus) zipStatus.textContent = msg || ""; }
