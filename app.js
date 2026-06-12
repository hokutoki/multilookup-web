const STORAGE_KEY = "multilookup.web.state.v1";
const DB_NAME = "multilookup-web";
const DB_VERSION = 1;
const DB_STORE = "settings";
const CHATGPT_APP_URL = "https://chatgpt.com/?q={query}";
const GOOGLE_MAPS_APP_URL = "https://www.google.com/maps/search/?api=1&query={query}";
const GROK_APP_URL = "https://grok.com/?q={query}";
const AUTO_ENABLED_PROVIDER_IDS = new Set(["chatGPT", "grok", "perplexity"]);
const AI_PROVIDER_IDS = ["grok", "chatGPT", "perplexity"];

const categories = [
  { id: "all", label: "すべて" },
  { id: "general", label: "検索" },
  { id: "dictionary", label: "辞書・辞典" },
  { id: "encyclopedia", label: "百科事典" },
  { id: "map", label: "地図" },
  { id: "video", label: "動画" },
  { id: "law", label: "法令" },
  { id: "ai", label: "AI" },
];

const defaultProviders = [
  provider("google", "Google検索", "G", "general", "https://www.google.com/search?q={query}", true, true),
  provider("googleImages", "Google画像検索", "画", "general", "https://www.google.com/search?tbm=isch&q={query}", true, false),
  provider("wikipediaJA", "Wikipedia日本語", "W", "encyclopedia", "https://ja.wikipedia.org/wiki/Special:Search?search={query}", true, true),
  provider("weblio", "Weblio", "W", "dictionary", "https://www.weblio.jp/content/{query}", true, true),
  provider("monokakido", "物書堂", "物", "dictionary", "mkdictionaries:///?text={query}&usePasteboardText=YES&scope=headword", true, false, "externalApp"),
  provider("appleMaps", "Appleマップ", "地", "map", "https://maps.apple.com/?q={query}", false, false),
  provider("googleMaps", "Googleマップ", "地", "map", GOOGLE_MAPS_APP_URL, false, false),
  provider("youtube", "YouTube", "▶", "video", "https://www.youtube.com/results?search_query={query}", false, false),
  provider("eGovLaw", "e-Gov法令検索", "法", "law", "https://laws.e-gov.go.jp/result?searchType=keyword&searchText={query}", false, false),
  provider("chatGPT", "ChatGPT", "AI", "ai", CHATGPT_APP_URL, false, false),
  provider("grok", "Grok", "G", "ai", GROK_APP_URL, true, false),
  provider("perplexity", "Perplexity", "P", "ai", "https://www.perplexity.ai/search?q={query}", false, false),
];

function provider(id, name, icon, category, template, enabled, batch, mode = "web") {
  return { id, name, icon, category, template, enabled, batch, mode };
}

let state = normalizeState({});
let activeCategory = "all";
let currentQuery = "";
let results = [];
let isReady = false;
let launchQueue = [];
let launchIndex = 0;
let lastAutoOpenedUrl = "";
let openedUrlsForCurrentSearch = new Set();

const els = {
  queryInput: document.querySelector("#queryInput"),
  searchForm: document.querySelector("#searchForm"),
  categoryList: document.querySelector("#categoryList"),
  historyList: document.querySelector("#historyList"),
  resultList: document.querySelector("#resultList"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  openBatchButton: document.querySelector("#openBatchButton"),
  quickOpenSection: document.querySelector("#quickOpenSection"),
  quickOpenGrid: document.querySelector("#quickOpenGrid"),
  quickOpenAllButton: document.querySelector("#quickOpenAllButton"),
  aiOpenBlock: document.querySelector("#aiOpenBlock"),
  aiOpenGrid: document.querySelector("#aiOpenGrid"),
  launcherPanel: document.querySelector("#launcherPanel"),
  launcherTitle: document.querySelector("#launcherTitle"),
  launcherMeta: document.querySelector("#launcherMeta"),
  openNextButton: document.querySelector("#openNextButton"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  providerSettings: document.querySelector("#providerSettings"),
  quickOpenInput: document.querySelector("#quickOpenInput"),
  exportButton: document.querySelector("#exportButton"),
  importInput: document.querySelector("#importInput"),
  saveStatus: document.querySelector("#saveStatus"),
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

const appReady = start();

els.searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isReady) return;
  runSearch(els.queryInput.value, { openFirst: state.quickOpen });
});

els.queryInput.addEventListener("input", () => {
  renderQuickOpen();
});

els.openBatchButton.addEventListener("click", () => {
  startLauncher();
});

els.quickOpenAllButton.addEventListener("click", () => {
  const query = quickOpenQuery();
  if (!query) return;
  if (query !== currentQuery) {
    runSearch(query, { openFirst: false });
  }
  startLauncher();
});

els.openNextButton.addEventListener("click", () => {
  openNextQueuedResult();
});

els.clearHistoryButton.addEventListener("click", async () => {
  await appReady;
  state.history = [];
  persist();
  renderHistory();
});

els.settingsButton.addEventListener("click", async () => {
  await appReady;
  renderSettings();
  els.settingsDialog.showModal();
});

els.exportButton.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "multilookup-settings.json";
  anchor.click();
  URL.revokeObjectURL(url);
});

els.importInput.addEventListener("change", async () => {
  try {
    await appReady;
    const file = els.importInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    const imported = JSON.parse(text);
    state = normalizeState(imported);
    persist();
    render();
    renderSettings();
    els.importInput.value = "";
  } catch {
    setSaveStatus("読み込みに失敗しました", true);
  }
});

async function start() {
  state = await loadState();
  isReady = true;
  setSaveStatus("設定を読み込みました");
  els.settingsButton.disabled = false;
  render();
  hydrateFromUrl();
}

function runSearch(rawQuery, options = {}) {
  const query = rawQuery.trim();
  if (!query) return;
  currentQuery = query;
  launchQueue = [];
  launchIndex = 0;
  openedUrlsForCurrentSearch = new Set();
  state.history = [query, ...state.history.filter((item) => item !== query)].slice(0, 20);
  results = filteredProviders()
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      provider,
      url: renderUrl(provider.template, query),
    }));
  persist();
  renderHistory();
  renderResults();
  renderQuickOpen();
  lastAutoOpenedUrl = "";
  const firstWebResult = webResults()[0];
  if (options.openFirst && firstWebResult) {
    lastAutoOpenedUrl = firstWebResult.url;
    openResult(firstWebResult);
  }
}

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const query = params.get("q");
  const category = params.get("category");
  if (category && categories.some((item) => item.id === category)) {
    activeCategory = category;
  }
  if (query) {
    els.queryInput.value = query;
    runSearch(query);
  }
}

function render() {
  renderCategories();
  renderHistory();
  renderResults();
  renderQuickOpen();
}

function renderCategories() {
  els.categoryList.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-button${activeCategory === category.id ? " active" : ""}`;
    button.textContent = category.label;
    button.addEventListener("click", () => {
      activeCategory = category.id;
      renderCategories();
      if (currentQuery) runSearch(currentQuery);
    });
    els.categoryList.append(button);
  });
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (state.history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "settings-note";
    empty.textContent = "履歴はまだありません";
    els.historyList.append(empty);
    return;
  }
  state.history.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-button";
    button.innerHTML = `<span>◷ ${escapeHtml(item)}</span><span>›</span>`;
    button.addEventListener("click", () => {
      els.queryInput.value = item;
      runSearch(item, { openFirst: state.quickOpen });
    });
    els.historyList.append(button);
  });
}

function renderResults() {
  els.resultList.innerHTML = "";
  if (!currentQuery) {
    els.resultTitle.textContent = "検索語を入力";
    els.resultMeta.textContent = "左の入力欄に言葉を入れて検索します。";
    els.openBatchButton.disabled = true;
    renderLauncher();
    renderQuickOpen();
    return;
  }

  els.resultTitle.textContent = currentQuery;
  els.resultMeta.textContent = `${results.length}件の検索先 / ${new Date().toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}`;
  els.openBatchButton.disabled = batchResults().length === 0;
  renderLauncher();

  results.forEach((result) => {
    const externalApp = isExternalAppResult(result);
    const card = document.createElement("article");
    card.className = `result-card${externalApp ? " app-result-card" : ""}`;
    card.innerHTML = `
      <div class="provider-icon" aria-hidden="true">${escapeHtml(result.provider.icon)}</div>
      <a class="result-link" href="${escapeAttribute(result.url)}" target="_blank" rel="noopener">
        <h3>${escapeHtml(result.provider.name)}</h3>
        <p>${escapeHtml(result.url)}</p>
      </a>
      <div class="result-actions">
        <a class="${externalApp ? "app-open-button" : "open-button"}" href="${escapeAttribute(result.url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(result.provider.name)}を開く">
          ${externalApp ? "物書堂を開く" : "開く"}
        </a>
        <button class="small-button" type="button" data-copy="${escapeHtml(result.provider.id)}" aria-label="${escapeHtml(result.provider.name)}のURLをコピー">
          <span aria-hidden="true">⧉</span>
          <span>コピー</span>
        </button>
      </div>
    `;
    card.querySelector("[data-copy]").addEventListener("click", async () => {
      await copyText(result.url);
    });
    els.resultList.append(card);
  });
}

function renderQuickOpen() {
  if (!els.quickOpenSection || !els.quickOpenGrid) return;
  els.quickOpenGrid.innerHTML = "";
  const query = quickOpenQuery();
  if (!query) {
    els.quickOpenSection.hidden = true;
    renderAiOpen([]);
    return;
  }

  els.quickOpenSection.hidden = false;
  quickOpenResults(query).forEach((result) => {
    const externalApp = isExternalAppResult(result);
    els.quickOpenGrid.append(createQuickOpenLink(result, externalApp));
  });
  renderAiOpen(aiOpenResults(query));
}

function quickOpenQuery() {
  return els.queryInput.value.trim() || currentQuery;
}

function quickOpenResults(query) {
  const preferred = ["google", "googleImages", "wikipediaJA", "weblio", "monokakido", "googleMaps"];
  const providerResults = state.providers
    .filter((providerItem) => providerItem.enabled)
    .map((providerItem) => ({
      provider: providerItem,
      url: renderUrl(providerItem.template, query),
    }));
  const byId = new Map(providerResults.map((result) => [result.provider.id, result]));
  return preferred
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, 8);
}

function aiOpenResults(query) {
  const byId = new Map(
    state.providers
      .filter((providerItem) => providerItem.enabled && providerItem.category === "ai")
      .map((providerItem) => [
        providerItem.id,
        {
          provider: providerItem,
          url: renderUrl(providerItem.template, query),
        },
      ]),
  );
  return AI_PROVIDER_IDS.map((id) => byId.get(id)).filter(Boolean);
}

function renderAiOpen(aiResults) {
  if (!els.aiOpenBlock || !els.aiOpenGrid) return;
  els.aiOpenGrid.innerHTML = "";
  els.aiOpenBlock.hidden = aiResults.length === 0;
  aiResults.forEach((result) => {
    els.aiOpenGrid.append(createQuickOpenLink(result, false, "ai-open-button"));
  });
}

function createQuickOpenLink(result, externalApp, extraClass = "") {
  const link = document.createElement("a");
  const classes = [
    "quick-open-button",
    `provider-${result.provider.id}`,
    externalApp ? "app-quick-open-button" : "",
    extraClass,
  ].filter(Boolean);
  link.className = classes.join(" ");
  link.href = result.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.innerHTML = `
    <span class="quick-open-icon" aria-hidden="true">${escapeHtml(result.provider.icon)}</span>
    <span>${escapeHtml(shortProviderName(result.provider.name))}</span>
  `;
  return link;
}

function shortProviderName(name) {
  return name
    .replace("Google検索", "Google")
    .replace("Google画像検索", "画像")
    .replace("Wikipedia日本語", "Wiki")
    .replace("Googleマップ", "地図");
}

function startLauncher() {
  launchQueue = batchResults().filter((result) => !openedUrlsForCurrentSearch.has(result.url));
  launchIndex = launchQueue[0]?.url === lastAutoOpenedUrl ? 1 : 0;
  openNextQueuedResult();
  renderLauncher();
}

function openNextQueuedResult() {
  let result = launchQueue[launchIndex];
  while (result && openedUrlsForCurrentSearch.has(result.url)) {
    launchIndex += 1;
    result = launchQueue[launchIndex];
  }
  if (!result) return;
  launchIndex += 1;
  openResult(result);
  renderLauncher();
}

function renderLauncher() {
  if (!els.launcherPanel) return;
  const hasQueue = launchQueue.length > 0 && launchIndex < launchQueue.length;
  els.launcherPanel.hidden = !hasQueue;
  if (!hasQueue) return;
  const result = launchQueue[launchIndex];
  els.launcherTitle.textContent = `次: ${result.provider.name}`;
  els.launcherMeta.textContent = `${launchIndex + 1}/${launchQueue.length}件目を開きます`;
}

function openResult(result) {
  if (!result) return;
  if (openedUrlsForCurrentSearch.has(result.url)) {
    renderLauncher();
    return;
  }
  openedUrlsForCurrentSearch.add(result.url);
  window.open(result.url, "_blank", "noopener");
}

function renderSettings() {
  els.providerSettings.innerHTML = "";
  els.quickOpenInput.checked = state.quickOpen;
  els.quickOpenInput.onchange = () => {
    state.quickOpen = els.quickOpenInput.checked;
    persist();
  };
  state.providers.forEach((providerItem, index) => {
    const row = document.createElement("div");
    row.className = "provider-row";
    row.innerHTML = `
      <input type="checkbox" ${providerItem.enabled ? "checked" : ""} aria-label="${escapeHtml(providerItem.name)}を有効化" />
      <div>
        <strong>${escapeHtml(providerItem.name)}</strong>
        <small>${escapeHtml(providerItem.template)}</small>
      </div>
      <div class="move-buttons">
        <button type="button" aria-label="${escapeHtml(providerItem.name)}を上へ">↑</button>
        <button type="button" aria-label="${escapeHtml(providerItem.name)}を下へ">↓</button>
      </div>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      providerItem.enabled = event.target.checked;
      persist();
      if (currentQuery) runSearch(currentQuery);
    });
    const [upButton, downButton] = row.querySelectorAll(".move-buttons button");
    upButton.disabled = index === 0;
    downButton.disabled = index === state.providers.length - 1;
    upButton.addEventListener("click", () => moveProvider(index, -1));
    downButton.addEventListener("click", () => moveProvider(index, 1));
    els.providerSettings.append(row);
  });
}

function moveProvider(index, delta) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= state.providers.length) return;
  const [item] = state.providers.splice(index, 1);
  state.providers.splice(nextIndex, 0, item);
  persist();
  renderSettings();
  if (currentQuery) runSearch(currentQuery);
}

function filteredProviders() {
  if (activeCategory === "all") return state.providers;
  return state.providers.filter((providerItem) => providerItem.category === activeCategory);
}

function batchResults() {
  return webResults().filter((result) => result.provider.batch).slice(0, 3);
}

function webResults() {
  return results.filter((result) => !isExternalAppResult(result));
}

function isExternalAppResult(result) {
  return result.provider.mode === "externalApp";
}

function renderUrl(template, query) {
  return template.replaceAll("{query}", encodeURIComponent(query));
}

async function loadState() {
  const localState = loadStateFromLocalStorage();
  if (localState) return localState;
  const indexedState = await loadStateFromIndexedDB();
  return indexedState || normalizeState({});
}

function loadStateFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function normalizeState(value) {
  const savedProviders = Array.isArray(value.providers) ? value.providers : [];
  const savedById = new Map(savedProviders.map((item) => [item.id, item]));
  const providers = defaultProviders.map((item) => mergeProvider(item, savedById.get(item.id)));
  providers.forEach((providerItem) => {
    if (AUTO_ENABLED_PROVIDER_IDS.has(providerItem.id)) providerItem.enabled = true;
  });
  savedProviders
    .filter((item) => !providers.some((providerItem) => providerItem.id === item.id))
    .forEach((item) => providers.push(item));
  return {
    providers,
    history: Array.isArray(value.history) ? value.history.slice(0, 20) : [],
    quickOpen: typeof value.quickOpen === "boolean" ? value.quickOpen : true,
  };
}

function mergeProvider(defaultProvider, savedProvider) {
  if (!savedProvider) return { ...defaultProvider };
  return {
    ...defaultProvider,
    enabled: typeof savedProvider.enabled === "boolean" ? savedProvider.enabled : defaultProvider.enabled,
    batch: typeof savedProvider.batch === "boolean" ? savedProvider.batch : defaultProvider.batch,
  };
}

function persist() {
  const serialized = JSON.stringify(state);
  let localSaved = false;
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    localSaved = localStorage.getItem(STORAGE_KEY) === serialized;
  } catch {
    localSaved = false;
  }

  saveStateToIndexedDB(serialized)
    .then(() => setSaveStatus(localSaved ? "保存済み" : "保存済み（予備領域）"))
    .catch(() => {
      setSaveStatus(localSaved ? "保存済み" : "保存できません", !localSaved);
    });
}

function openSettingsDB() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadStateFromIndexedDB() {
  try {
    const db = await openSettingsDB();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(DB_STORE, "readonly");
      const store = transaction.objectStore(DB_STORE);
      const request = store.get(STORAGE_KEY);
      request.onsuccess = () => {
        if (!request.result) {
          resolve(null);
          return;
        }
        try {
          resolve(normalizeState(JSON.parse(request.result)));
        } catch {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function saveStateToIndexedDB(serialized) {
  const db = await openSettingsDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.objectStore(DB_STORE).put(serialized, STORAGE_KEY);
  });
}

function setSaveStatus(message, isError = false) {
  if (!els.saveStatus) return;
  els.saveStatus.textContent = message;
  els.saveStatus.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("input");
    input.value = value;
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}
