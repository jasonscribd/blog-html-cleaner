const pasteTarget = document.getElementById("pasteTarget");
const preview = document.getElementById("preview");
const cleanBtn = document.getElementById("cleanBtn");
const validateLinksBtn = document.getElementById("validateLinksBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const linkStatus = document.getElementById("linkStatus");
const sourceUrl = document.getElementById("sourceUrl");
const loadUrlBtn = document.getElementById("loadUrlBtn");
const downloadThumbsBtn = document.getElementById("downloadThumbsBtn");
const thumbStatus = document.getElementById("thumbStatus");
const seoTitle = document.getElementById("seoTitle");
const seoDescription = document.getElementById("seoDescription");
const validatedLinks = document.getElementById("validatedLinks");

const START_PROMPTS = ["Start Reading", "Start Listening"];
const DEAD_PAGE_MARKER =
  "The page you are looking for is no longer here, or never existed in the first place (bummer).";
const CONTENT_SELECTORS = [
  "article [itemprop='articleBody']",
  "article .entry-content",
  "article .post-content",
  "article .article-content",
  "article .post-body",
  "article",
  ".entry-content",
  ".post-content",
  ".article-content",
  ".post-body",
  "main article",
  "main"
];
const fetchHtmlCache = new Map();
let currentSourceHtml = "";
let currentCleanHtml = "";

pasteTarget.addEventListener("paste", (event) => {
  const html = event.clipboardData?.getData("text/html");
  const text = event.clipboardData?.getData("text/plain") || "";

  if (!html && !text) {
    return;
  }

  event.preventDefault();

  if (html) {
    currentSourceHtml = html;
    pasteTarget.innerText = text || "Pasted rich text captured.";
  } else {
    currentSourceHtml = textToHtml(text);
    pasteTarget.innerText = text;
  }

  currentCleanHtml = "";
  preview.innerHTML = "";
  clearSeoFields();
  clearValidatedLinksOutput();
});

cleanBtn.addEventListener("click", () => {
  const source = currentSourceHtml || pasteTarget.innerHTML || "";
  const cleaned = cleanForContentful(source);
  currentCleanHtml = cleaned;
  preview.innerHTML = cleaned;
  clearValidatedLinksOutput();
  setStatus("Clean complete.");
});

validateLinksBtn.addEventListener("click", async () => {
  await validateLinksInOutput();
});

copyBtn.addEventListener("click", async () => {
  const previewHtml = sanitizeOutput(preview.innerHTML || "");
  if (!previewHtml) {
    return;
  }

  await navigator.clipboard.writeText(previewHtml);
  copyBtn.textContent = "Copied";
  setTimeout(() => {
    copyBtn.textContent = "Copy Clean Preview";
  }, 1200);
});

clearBtn.addEventListener("click", () => {
  pasteTarget.innerHTML = "";
  currentSourceHtml = "";
  currentCleanHtml = "";
  preview.innerHTML = "";
  clearSeoFields();
  clearValidatedLinksOutput();
  fetchHtmlCache.clear();
  setStatus("");
  setThumbStatus("");
});

loadUrlBtn.addEventListener("click", async () => {
  await loadSourceFromUrl();
});

downloadThumbsBtn.addEventListener("click", async () => {
  await downloadThumbnailsZipFromUrl();
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

async function loadSourceFromUrl() {
  const rawUrl = normalizeSpace(sourceUrl.value || "");
  if (!rawUrl) {
    setStatus("Enter a blog URL first.");
    return;
  }

  const normalizedUrl = normalizeImportUrl(rawUrl);
  if (!normalizedUrl) {
    setStatus("Enter a valid URL (must start with http:// or https://).");
    return;
  }

  loadUrlBtn.disabled = true;
  setStatus("Loading page and extracting article content...");

  try {
    const html = await fetchImportHtml(normalizedUrl);
    if (!html) {
      setStatus("Could not fetch the page content. Try copy/paste for this URL.");
      return;
    }

    const seo = extractSeoMetadataFromRawPage(html, normalizedUrl);
    setSeoFields(seo.title, seo.description);

    const extracted = extractArticleHtml(html);
    if (!extracted) {
      setStatus("Could not find article content on that page. Try copy/paste.");
      return;
    }

    currentSourceHtml = extracted;
    currentCleanHtml = "";
    preview.innerHTML = "";
    clearValidatedLinksOutput();
    const previewDoc = new DOMParser().parseFromString(`<body>${extracted}</body>`, "text/html");
    const previewText = normalizeSpace(previewDoc.body.textContent || "");
    pasteTarget.innerText = previewText.slice(0, 400) + (previewText.length > 400 ? "..." : "");
    setStatus("Loaded source HTML from URL.");
  } finally {
    loadUrlBtn.disabled = false;
  }
}

async function downloadThumbnailsZipFromUrl() {
  const rawUrl = normalizeSpace(sourceUrl.value || "");
  if (!rawUrl) {
    setThumbStatus("Enter a blog URL first.");
    return;
  }

  const normalizedUrl = normalizeImportUrl(rawUrl);
  if (!normalizedUrl) {
    setThumbStatus("Enter a valid URL (must start with http:// or https://).");
    return;
  }

  if (typeof JSZip === "undefined") {
    setThumbStatus("ZIP support failed to load. Refresh and try again.");
    return;
  }

  downloadThumbsBtn.disabled = true;
  setThumbStatus("Loading post and collecting thumbnail images...");

  try {
    const rawPage = await fetchPageForThumbnails(normalizedUrl);
    if (!rawPage) {
      setThumbStatus("Could not fetch this URL. Try another link or manual image download.");
      return;
    }

    const postTitle = extractPostTitle(rawPage, normalizedUrl);
    const imageUrls = extractThumbnailImageUrls(rawPage, normalizedUrl);
    if (imageUrls.length === 0) {
      setThumbStatus("No thumbnail images found in the post content.");
      return;
    }

    const zip = new JSZip();
    let added = 0;
    let failed = 0;
    let processed = 0;

    const imageResults = await processInBatches(imageUrls, 4, async (imageUrl) => {
      const blob = await fetchImageBlob(imageUrl);
      if (!blob) {
        processed++;
        setThumbStatus(`Processing ${processed}/${imageUrls.length}...`);
        return null;
      }
      const resized = await resizeImageBlobToWidth(blob, 300);
      processed++;
      setThumbStatus(`Processing ${processed}/${imageUrls.length}...`);
      return resized ? { resized, imageUrl } : null;
    });

    for (const result of imageResults) {
      if (!result) {
        failed += 1;
        continue;
      }
      const ext = extensionFromBlobType(result.resized.type) || "jpg";
      const fileName = `${String(added + 1).padStart(2, "0")}-${slugifyFilename(basenameFromUrl(result.imageUrl))}.${ext}`;
      zip.file(fileName, result.resized);
      added += 1;
    }

    if (added === 0) {
      setThumbStatus("Could not process images from this post (blocked by host/CORS).");
      return;
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const zipName = `${slugifyFilename(postTitle || "post-thumbnails")}.zip`;
    triggerDownload(zipBlob, zipName);

    if (failed > 0) {
      setThumbStatus(`Downloaded ${added} images. ${failed} could not be fetched.`);
    } else {
      setThumbStatus(`Downloaded ${added} images.`);
    }
  } finally {
    downloadThumbsBtn.disabled = false;
  }
}

async function fetchPageForThumbnails(url) {
  if (fetchHtmlCache.has(url)) {
    return fetchHtmlCache.get(url);
  }
  const body = await raceForFirstValid(
    [() => fetchDirectHtmlForImport(url), () => fetchAllOriginsHtml(url), () => fetchCorsProxyHtml(url), () => fetchJinaHtml(url)],
    (result) => result && result.trim(),
    ""
  );
  if (body) {
    fetchHtmlCache.set(url, body);
  }
  return body;
}

function extractPostTitle(rawBody, fallbackUrl) {
  const trimmed = (rawBody || "").trim();
  if (!trimmed) {
    return fallbackUrl;
  }

  if (!/<html|<head|<body/i.test(trimmed)) {
    const markdownTitle = trimmed.match(/^\s*Title:\s*(.+)$/im);
    if (markdownTitle && normalizeSpace(markdownTitle[1])) {
      return normalizeSpace(markdownTitle[1]);
    }
    return fallbackUrl;
  }

  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  const h1 = normalizeSpace(doc.querySelector("article h1, h1")?.textContent || "");
  if (h1) {
    return h1;
  }

  const title = normalizeSpace(doc.querySelector("title")?.textContent || "");
  if (title) {
    return title.replace(/\s*[\|\-]\s*Everand.*$/i, "").trim();
  }

  return fallbackUrl;
}

function extractThumbnailImageUrls(rawBody, pageUrl) {
  const trimmed = (rawBody || "").trim();
  if (!trimmed) {
    return [];
  }

  if (!/<html|<head|<body/i.test(trimmed)) {
    const markdownUrls = Array.from(trimmed.matchAll(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi)).map((m) => m[1]);
    return uniqueUrls(markdownUrls);
  }

  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  const candidateRoot = pickBestContentRoot(doc) || doc.body;
  if (!candidateRoot) {
    return [];
  }

  const urls = [];
  candidateRoot.querySelectorAll("img").forEach((img) => {
    const width = Number.parseInt(img.getAttribute("width") || "0", 10);
    const height = Number.parseInt(img.getAttribute("height") || "0", 10);
    if ((width > 0 && width < 90) || (height > 0 && height < 90)) {
      return;
    }

    const srcset = img.getAttribute("srcset") || "";
    const srcCandidate = pickBestSrcsetUrl(srcset) || img.getAttribute("src") || img.getAttribute("data-src") || "";
    const abs = toAbsoluteHttpUrl(srcCandidate, pageUrl);
    if (abs) {
      urls.push(abs);
    }
  });

  return uniqueUrls(urls);
}

function pickBestContentRoot(doc) {
  let bestNode = null;
  let bestScore = 0;
  CONTENT_SELECTORS.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((node) => {
      const score = normalizeSpace(node.textContent || "").length;
      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    });
  });
  return bestNode;
}

function pickBestSrcsetUrl(srcset) {
  if (!srcset) {
    return "";
  }

  const parts = srcset
    .split(",")
    .map((entry) => normalizeSpace(entry))
    .filter(Boolean)
    .map((entry) => {
      const items = entry.split(/\s+/);
      const url = items[0] || "";
      const sizeToken = items[1] || "";
      const size = Number.parseInt(sizeToken.replace(/[^\d]/g, ""), 10) || 0;
      return { url, size };
    })
    .filter((item) => item.url);

  if (parts.length === 0) {
    return "";
  }

  parts.sort((a, b) => b.size - a.size);
  return parts[0].url;
}

function toAbsoluteHttpUrl(maybeUrl, baseUrl) {
  const raw = normalizeSpace(maybeUrl || "");
  if (!raw) {
    return "";
  }

  try {
    const absolute = new URL(raw, baseUrl).toString();
    return /^https?:\/\//i.test(absolute) ? absolute : "";
  } catch {
    return "";
  }
}

function uniqueUrls(urls) {
  const seen = new Set();
  const result = [];
  urls.forEach((url) => {
    const normalized = normalizeSpace(url);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

async function fetchImageBlob(url) {
  return await raceForFirstValid(
    [
      () => fetchBlobDirect(url),
      () => fetchBlobViaCorsProxy(url),
      () => fetchBlobViaCorsProxy(url, "https://api.allorigins.win/raw?url=")
    ],
    (blob) => blob && blob.size > 0,
    null
  );
}

async function fetchBlobDirect(url) {
  try {
    const response = await fetchWithTimeout(url, { method: "GET", mode: "cors", redirect: "follow" }, 12000);
    if (!response.ok) {
      return null;
    }
    return await response.blob();
  } catch {
    return null;
  }
}

async function fetchBlobViaCorsProxy(url, prefix = "https://corsproxy.io/?") {
  try {
    const proxyUrl = `${prefix}${encodeURIComponent(url)}`;
    const response = await fetchWithTimeout(proxyUrl, { method: "GET", mode: "cors" }, 12000);
    if (!response.ok) {
      return null;
    }
    return await response.blob();
  } catch {
    return null;
  }
}

async function resizeImageBlobToWidth(blob, targetWidth) {
  try {
    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width || 0;
    const height = bitmap.height || 0;
    if (width <= 0 || height <= 0) {
      bitmap.close();
      return null;
    }

    const scale = targetWidth / width;
    const outputWidth = Math.max(1, Math.round(targetWidth));
    const outputHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return null;
    }

    ctx.drawImage(bitmap, 0, 0, outputWidth, outputHeight);
    bitmap.close();

    const outType = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
    return await new Promise((resolve) => {
      canvas.toBlob((b) => resolve(b), outType, 0.9);
    });
  } catch {
    return null;
  }
}

function basenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const raw = parsed.pathname.split("/").filter(Boolean).pop() || "image";
    return raw.replace(/\.[^.]+$/, "");
  } catch {
    return "image";
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
  const normalized = (type || "").toLowerCase();
  if (normalized.includes("png")) {
    return "png";
  }
  if (normalized.includes("webp")) {
    return "webp";
  }
  if (normalized.includes("gif")) {
    return "gif";
  }
  if (normalized.includes("jpeg") || normalized.includes("jpg")) {
    return "jpg";
  }
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

function normalizeImportUrl(input) {
  const maybeUrl = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const parsed = new URL(maybeUrl);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

async function fetchImportHtml(url) {
  if (fetchHtmlCache.has(url)) {
    return fetchHtmlCache.get(url);
  }
  const html = await raceForFirstValid(
    [() => fetchDirectHtmlForImport(url), () => fetchAllOriginsHtml(url), () => fetchCorsProxyHtml(url)],
    (result) => result && result.trim() && /<html|<article|<body/i.test(result),
    ""
  );
  if (html) {
    fetchHtmlCache.set(url, html);
  }
  return html;
}

async function fetchDirectHtmlForImport(url) {
  try {
    const response = await fetchWithTimeout(url, { method: "GET", redirect: "follow", mode: "cors" }, 10000);
    if (!response.ok) {
      return "";
    }
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html")) {
      return "";
    }
    return await response.text();
  } catch {
    return "";
  }
}

async function fetchCorsProxyHtml(url) {
  try {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const response = await fetchWithTimeout(proxyUrl, { method: "GET", mode: "cors" }, 10000);
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch {
    return "";
  }
}

function extractArticleHtml(rawHtml) {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  const candidates = [];
  CONTENT_SELECTORS.forEach((selector) => {
    doc.querySelectorAll(selector).forEach((node) => candidates.push(node));
  });
  if (candidates.length === 0 && doc.body) {
    candidates.push(doc.body);
  }

  let bestNode = null;
  let bestScore = 0;
  candidates.forEach((node) => {
    const cloned = node.cloneNode(true);
    removeNoiseNodes(cloned);
    const textSize = normalizeSpace(cloned.textContent || "").length;
    if (textSize > bestScore) {
      bestScore = textSize;
      bestNode = cloned;
    }
  });

  if (!bestNode || bestScore < 60) {
    return "";
  }

  removeNoiseNodes(bestNode);
  return bestNode.innerHTML || "";
}

function removeNoiseNodes(rootNode) {
  rootNode
    .querySelectorAll(
      "script,style,noscript,iframe,svg,canvas,form,nav,footer,header,aside,.newsletter,.subscribe,.related,.share,.social,.breadcrumbs,.author-bio"
    )
    .forEach((el) => el.remove());
}

async function validateLinksInOutput() {
  const current = currentCleanHtml.trim();
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
  let removedDead = 0;
  const okLinks = [];
  const removedLinks = [];
  const unconfirmedLinks = [];

  setStatus(`Validating ${links.length} links (best effort)...`);

  try {
    let checkedCount = 0;
    const results = await processInBatches(links, 5, async (link) => {
      const href = link.getAttribute("href") || "";
      const result = await checkLinkForDeadPage(href);
      checkedCount++;
      setStatus(`Validating links: ${checkedCount}/${links.length} checked...`);
      return { link, href, result };
    });

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
    if (unconfirmedLinks.length > 0) {
      parts.push(`${unconfirmedLinks.length} unconfirmed (kept)`);
    }
    setStatus(`Validation done: ${parts.join(", ")}.`);
  } finally {
    validateLinksBtn.disabled = false;
  }
}

async function checkLinkForDeadPage(url) {
  const href = (url || "").trim();
  if (!href || !/^https?:\/\//i.test(href)) {
    return "unknown";
  }

  const settled = await Promise.allSettled([
    fetchDirectProbe(href),
    fetchAllOriginsProbe(href),
    fetchJinaProbe(href)
  ]);

  let sawConfirmedOk = false;
  for (const entry of settled) {
    const result = entry.status === "fulfilled" ? entry.value : null;
    if (!result) {
      continue;
    }

    if (result.status === 404 || result.status === 410) {
      return "dead";
    }

    if (result.nonHtml) {
      if (result.status >= 200 && result.status < 400) {
        sawConfirmedOk = true;
      }
      continue;
    }

    const body = normalizeSpace((result.body || "").toLowerCase());
    if (!body) {
      continue;
    }

    if (isChallengePageBody(body)) {
      if (result.status >= 200 && result.status < 400) {
        sawConfirmedOk = true;
      }
      continue;
    }

    if (isDeadPageBody(body)) {
      return "dead";
    }

    if (result.status >= 200 && result.status < 400) {
      sawConfirmedOk = true;
    }
  }

  return sawConfirmedOk ? "ok" : "unknown";
}

function isDeadPageBody(body) {
  const deadMarkers = [
    normalizeSpace(DEAD_PAGE_MARKER).toLowerCase(),
    "page not found - everand blog",
    "page not found",
    "status code: 404",
    "http/2 404",
    "no longer here",
    "never existed in the first place",
    "always start over from the home page"
  ];
  return deadMarkers.some((marker) => body.includes(marker));
}

function isChallengePageBody(body) {
  const challengeMarkers = [
    "client challenge",
    "just a moment",
    "cf-challenge",
    "captcha",
    "access denied",
    "security check"
  ];
  return challengeMarkers.some((marker) => body.includes(marker));
}

async function fetchDirectProbe(url) {
  try {
    const response = await fetchWithTimeout(url, { method: "GET", redirect: "follow", mode: "cors" }, 8000);
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const nonHtml = !contentType.includes("text/html");
    const body = nonHtml ? "" : await response.text();
    return {
      status: response.status || 0,
      nonHtml,
      body
    };
  } catch {
    return null;
  }
}

async function fetchAllOriginsProbe(url) {
  try {
    const endpoint = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const response = await fetchWithTimeout(endpoint, { method: "GET", mode: "cors" }, 10000);
    const body = await response.text();
    return {
      status: response.status || 0,
      nonHtml: false,
      body
    };
  } catch {
    return null;
  }
}

async function fetchJinaProbe(url) {
  try {
    const endpoint = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`;
    const response = await fetchWithTimeout(endpoint, { method: "GET", mode: "cors" }, 10000);
    const body = await response.text();
    return {
      status: response.status || 0,
      nonHtml: false,
      body
    };
  } catch {
    return null;
  }
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

async function raceForFirstValid(probeFns, isValid, fallback) {
  const raceable = probeFns.map((fn) =>
    fn().then((result) => (isValid(result) ? result : Promise.reject()))
  );
  try {
    return await Promise.any(raceable);
  } catch {
    return fallback;
  }
}

async function processInBatches(items, concurrency, processFn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await processFn(items[index], index);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
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
  const elements = Array.from(root.querySelectorAll("*"));
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!allowed.has(el.nodeName)) {
      el.replaceWith(...el.childNodes);
    }
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
  const elements = Array.from(root.querySelectorAll("*"));
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.nodeName === "BR") {
      continue;
    }
    if (el.children.length === 0 && normalizeSpace(el.textContent || "") === "") {
      el.remove();
    }
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

function extractSeoMetadataFromRawPage(rawBody, fallbackUrl) {
  const trimmed = (rawBody || "").trim();
  if (!trimmed) {
    return { title: "", description: "" };
  }

  if (!/<html|<head|<body/i.test(trimmed)) {
    const titleMatch = trimmed.match(/^\s*Title:\s*(.+)$/im);
    const descriptionMatch = trimmed.match(/^\s*(?:Description|SEO Description):\s*(.+)$/im);
    return {
      title: normalizeSpace(titleMatch?.[1] || ""),
      description: normalizeSpace(descriptionMatch?.[1] || "")
    };
  }

  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  const title = firstNonEmpty([
    doc.querySelector("meta[property='og:title']")?.getAttribute("content"),
    doc.querySelector("meta[name='twitter:title']")?.getAttribute("content"),
    doc.querySelector("meta[name='title']")?.getAttribute("content"),
    doc.querySelector("title")?.textContent,
    doc.querySelector("article h1, h1")?.textContent,
    extractPostTitle(rawBody, fallbackUrl)
  ]);

  const description = firstNonEmpty([
    doc.querySelector("meta[name='description']")?.getAttribute("content"),
    doc.querySelector("meta[property='og:description']")?.getAttribute("content"),
    doc.querySelector("meta[name='twitter:description']")?.getAttribute("content"),
    doc.querySelector("meta[name='Description']")?.getAttribute("content")
  ]);

  return {
    title: normalizeSeoTitle(title),
    description: normalizeSpace(description || "")
  };
}

function firstNonEmpty(values) {
  for (const value of values) {
    const normalized = normalizeSpace(String(value || ""));
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function normalizeSeoTitle(title) {
  const normalized = normalizeSpace(title || "");
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\s*[\|\-]\s*Everand.*$/i, "").trim();
}

function setSeoFields(title, description) {
  seoTitle.value = normalizeSpace(title || "");
  seoDescription.value = normalizeSpace(description || "");
}

function clearSeoFields() {
  seoTitle.value = "";
  seoDescription.value = "";
}

function clearValidatedLinksOutput() {
  validatedLinks.value = "";
}

function formatValidatedLinksByType(urls, removedUrls = [], unconfirmedUrls = []) {
  const uniqueOk = uniqueUrls(
    urls
      .map((url) => normalizeSpace(url))
      .filter((url) => /^https?:\/\//i.test(url))
  );
  const uniqueRemoved = uniqueUrls(
    removedUrls
      .map((url) => normalizeSpace(url))
      .filter((url) => /^https?:\/\//i.test(url))
  );
  const uniqueUnconfirmed = uniqueUrls(
    unconfirmedUrls
      .map((url) => normalizeSpace(url))
      .filter((url) => /^https?:\/\//i.test(url))
  );

  if (uniqueOk.length === 0 && uniqueRemoved.length === 0 && uniqueUnconfirmed.length === 0) {
    return "";
  }

  const grouped = new Map();
  uniqueOk.forEach((url) => {
    const type = linkTypeForUrl(url);
    if (!grouped.has(type)) {
      grouped.set(type, []);
    }
    grouped.get(type).push(url);
  });

  const output = [];
  const orderedTypes = ["Blog Links", "Book Links", "Other Links"];
  orderedTypes.forEach((type) => {
    const list = grouped.get(type) || [];
    if (list.length === 0) {
      return;
    }
    output.push(`${type}:`);
    output.push(list.join("\n"));
  });

  if (uniqueUnconfirmed.length > 0) {
    output.push("Unconfirmed Links (kept — could not verify, please spot-check):");
    output.push(uniqueUnconfirmed.join("\n"));
  }

  if (uniqueRemoved.length > 0) {
    output.push("Removed Links:");
    output.push(uniqueRemoved.join("\n"));
  }

  return output.join("\n\n");
}

function linkTypeForUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.startsWith("/blog/")) {
      return "Blog Links";
    }
    if (
      path.startsWith("/audiobook/") ||
      path.startsWith("/book/") ||
      path.startsWith("/ebook/") ||
      path.startsWith("/series/")
    ) {
      return "Book Links";
    }
  } catch {
    return "Other Links";
  }
  return "Other Links";
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

function setThumbStatus(message) {
  thumbStatus.textContent = message;
}
