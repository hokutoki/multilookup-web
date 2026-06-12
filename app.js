const STORAGE_KEY = "multilookup.web.state.v1";
const DB_NAME = "multilookup-web";
const DB_VERSION = 1;
const DB_STORE = "settings";

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
  provider("monokakido", "物書堂", "物", "dictionary", "mkdictionaries:///?text={query}&usePasteboardText=YES&scope=headword", true, false),
  provider("appleMaps", "Appleマップ", "地", "map", "https://maps.apple.com/?q={query}", false, false),
  provider("googleMaps", "Googleマップ", "地", "map", "https://www.google.com/maps/search/?api=1&query={query}", false, false),
  provider("youtube", "YouTube", "▶", "video", "https://www.youtube.com/results?search_query={query}", false, false),
  provider("eGovLaw", "e-Gov法令検索", "法", "law", "https://laws.e-gov.go.jp/result?searchType=keyword&searchText={query}", false, false),
  provider("chatGPT", "ChatGPT", "AI", "ai", "https://chatgpt.com/?q={query}", false, false),
  provider("grok", "Grok", "G", "ai", "https://grok.com/?q={query}", false, false),
  provider("perplexity", "Perplexity", "P", "ai", "https://www.perplexity.ai/search?q={query}", false, false),
];

function provider(id, name, icon, category, template, enabled, batch) {
  return { id, name, icon, category, template, enabled, batch };
}

let state = normalizeState({});
let activeCategory = "all";
let currentQuery = "";
let results = [];
let isReady = false;
let launchQueue = [];
let launchIndex = 0;
let lastAutoOpenedUrl = "";

const els = {
  queryInput: document.querySelector("#queryInput"),
  searchForm: document.querySelector("#searchForm"),
  categoryList: document.querySelector("#categoryList"),
  historyList: document.querySelector("#historyList"),
  resultList: document.querySelector("#resultList"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  openBatchButton: document.querySelector("#openBatchButton"),
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

els.openBatchButton.addEventListener("click", () => {
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
  lastAutoOpenedUrl = "";
  if (options.openFirst && results[0]) {
    lastAutoOpenedUrl = results[0].url;
    openResult(results[0]);
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
    return;
  }

  els.resultTitle.textContent = currentQuery;
  els.resultMeta.textContent = `${results.length}件の検索先 / ${new Date().toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" })}`;
  els.openBatchButton.disabled = batchResults().length === 0;
  renderLauncher();

  results.forEach((result) => {
    const card = document.createElement("article");
    card.className = "result-card";
    card.innerHTML = `
      <div class="provider-icon" aria-hidden="true">${escapeHtml(result.provider.icon)}</div>
      <a class="result-link" href="${escapeAttribute(result.url)}" target="_blank" rel="noopener">
        <h3>${escapeHtml(result.provider.name)}</h3>
        <p>${escapeHtml(result.url)}</p>
      </a>
      <div class="result-actions">
        <button class="small-button" type="button" data-copy="${escapeHtml(result.provider.id)}" aria-label="${escapeHtml(result.provider.name)}のURLをコピー">⧉</button>
      </div>
    `;
    card.querySelector("[data-copy]").addEventListener("click", async () => {
      await copyText(result.url);
    });
    els.resultList.append(card);
  });
}

function startLauncher() {
  launchQueue = batchResults();
  launchIndex = launchQueue[0]?.url === lastAutoOpenedUrl ? 1 : 0;
  openNextQueuedResult();
  renderLauncher();
}

function openNextQueuedResult() {
  const result = launchQueue[launchIndex];
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
  return results.filter((result) => result.provider.batch).slice(0, 3);
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
  const providers = defaultProviders.map((item) => ({ ...item, ...savedById.get(item.id) }));
  savedProviders
    .filter((item) => !providers.some((providerItem) => providerItem.id === item.id))
    .forEach((item) => providers.push(item));
  return {
    providers,
    history: Array.isArray(value.history) ? value.history.slice(0, 20) : [],
    quickOpen: typeof value.quickOpen === "boolean" ? value.quickOpen : true,
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
