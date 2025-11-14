import { WormholeCore, WormholeStatus } from "@wormhole/core";


const RELAY_URL = import.meta.env.VITE_RELAY_URL;
const AUTH_TOKEN = import.meta.env.VITE_AUTH_TOKEN;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof window !== "undefined" && !window.ShogunRelays) {
    try {
      await import("shogun-relays");
    } catch (error) {
      console.warn("Impossibile caricare shogun-relays:", error);
    }
  }
  const gunGlobal = window.Gun;

  if (!gunGlobal) {
    console.error("Gun non è stato caricato correttamente.");
    return;
  }

  setupGunOptHook(gunGlobal);

  const elements = getDomElements();
  const state = {
    selectedFile: null,
    transferInProgress: false,
    currentCode: null,
    activeTab: "send",
  };

  const relayManager = window.ShogunRelays;

  let relays = [];
  try {
    if (relayManager?.forceListUpdate) {
      relays = await relayManager.forceListUpdate();
    } else {
      console.warn("ShogunRelays.forceListUpdate non disponibile. Uso relay di default.");
    }
  } catch (error) {
    console.warn("Impossibile recuperare l'elenco dei relay:", error);
  }

  const defaultPeers = [
     "https://shogun-relay.scobrudot.dev/gun",
     "https://shogun-linda-relay.scobrudot.dev/gun",
     "https://peer.wallie.io/gun",
     "https://gun.defucc.me/gun",
     "https://a.talkflow.team/gun",
  ];

  const peerSet = new Set(defaultPeers);
  relays.forEach((relayUrl) => {
    if (typeof relayUrl === "string" && relayUrl.trim().length > 0) {
      peerSet.add(relayUrl);
    }
  });

  const gunInstance = gunGlobal({
    peers: Array.from(peerSet),
    localStorage: false,
    radisk: false,
  });

  const wormhole = new WormholeCore({
    gun: gunInstance,
    onStatusChange: handleStatusChange,
    onProgress: handleProgress,
  });

  wireEventListeners();
  resetUI();

  function wireEventListeners() {
    elements.tabButtons.forEach((button) => {
      button.addEventListener("click", () => switchTab(button.dataset.tabButton));
    });

    elements.sendPrompt.addEventListener("click", () => {
      if (state.selectedFile || state.transferInProgress) {
        return;
      }
      elements.fileInput.click();
      updateDropZoneStyle(true);
      window.setTimeout(() => updateDropZoneStyle(false), 200);
    });

    elements.fileInput.addEventListener("change", (event) => {
      handleFileSelect(event.target.files?.[0] ?? null);
    });

    ["dragover", "dragleave", "drop"].forEach((eventName) => {
      elements.sendPrompt.addEventListener(eventName, (event) => {
        handleDragEvent(eventName, event);
      });
    });

    elements.sendButton.addEventListener("click", () => {
      void sendFile();
    });
    elements.copyCodeButton.addEventListener("click", () => {
      void copyCode();
    });
    elements.receiveButton.addEventListener("click", () => {
      connectToSender();
    });
  }

  function handleDragEvent(eventName, event) {
    event.preventDefault();
    event.stopPropagation();

    if (state.selectedFile) {
      return;
    }

    if (eventName === "dragover") {
      updateDropZoneStyle(true);
    }

    if (eventName === "dragleave") {
      updateDropZoneStyle(false);
    }

    if (eventName === "drop") {
      updateDropZoneStyle(false);
      const droppedFile = event.dataTransfer?.files?.[0];
      handleFileSelect(droppedFile ?? null);
    }
  }

  function switchTab(tab) {
    state.activeTab = tab;

    elements.tabButtons.forEach((button) => {
      button.classList.toggle("tab-active", button.dataset.tabButton === tab);
    });

    Object.entries(elements.tabPanels).forEach(([panelKey, panelElement]) => {
      panelElement.classList.toggle("hidden", panelKey !== tab);
    });
  }

  async function copyCode() {
    if (!state.currentCode) {
      showStatus("send", "info", "📋 Nessun codice disponibile al momento.");
      return;
    }

    try {
      await navigator.clipboard.writeText(state.currentCode);
      showStatus("send", "info", "📋 Codice copiato negli appunti!");
    } catch (error) {
      console.error(error);
      showStatus("send", "error", "❌ Impossibile copiare il codice.");
    }
  }

  function updateDropZoneStyle(isActive) {
    const highlightClasses = ["bg-accent", "bg-opacity-10"];
    highlightClasses.forEach((className) => {
      elements.sendPrompt.classList.toggle(className, isActive);
    });
  }

  function handleFileSelect(file) {
    if (!file) {
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      showStatus("send", "error", "❌ File troppo grande. Il limite è 100MB.");
      return;
    }

    state.selectedFile = file;
    elements.sendPrompt.classList.add("hidden");
    elements.fileInfoSection.classList.remove("hidden");
    elements.sendButton.disabled = false;

    const icon = getFileIcon(file.type);
    const formattedSize = formatBytes(file.size);
    elements.fileDetails.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-2xl">${icon}</span>
        <strong class="text-accent break-all">${file.name}</strong>
      </div>
      <div class="mt-2 text-sm text-gray-400">
        <div class="flex items-center gap-2">
          <span>📏 Dimensione: ${formattedSize}</span>
        </div>
        <div class="flex items-center gap-2 mt-1">
          <span>📋 Tipo: ${file.type || "Sconosciuto"}</span>
        </div>
      </div>
    `;

    showStatus("send", "success", "✅ File selezionato con successo!");
    window.setTimeout(() => {
      elements.status.send.innerHTML = "";
    }, 3000);
  }

  async function checkRelayStatus() {
    try {
      const response = await fetch(`${RELAY_URL}/health`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
      });
      if (!response.ok) {
        console.warn(`Relay health check returned ${response.status}: ${response.statusText}`);
        // Don't block the transfer if health check fails - the relay might still work
        return true;
      }
      return true;
    } catch (error) {
      // Handle CORS errors and network failures gracefully
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        console.warn('Relay health check failed (CORS or network error). Continuing anyway...', error);
        // Don't block the transfer - CORS might be an issue but the relay could still work
        return true;
      }
      console.warn('Relay health check error:', error);
      // Don't block the transfer on health check failures
      return true;
    }
  }

  async function sendFile() {
    if (!state.selectedFile || state.transferInProgress) {
      return;
    }

    if (!(await checkRelayStatus())) {
      return;
    }

    state.transferInProgress = true;
    elements.sendButton.disabled = true;

    try {
      const transferCode = await wormhole.send({
        file: state.selectedFile,
        filename: state.selectedFile.name,
        size: state.selectedFile.size,
        type: state.selectedFile.type,
        relayUrl: RELAY_URL,
        authToken: AUTH_TOKEN,
        lastModified: state.selectedFile.lastModified,
      });

      state.currentCode = transferCode;
      elements.transferCodeDisplay.textContent = transferCode;
      elements.codeSection.classList.remove("hidden");
      elements.fileInfoSection.classList.add("hidden");
    } catch (error) {
      console.error(error);
      showStatus("send", "error", `❌ Upload fallito: ${error.message ?? "Errore sconosciuto"}`);
      state.transferInProgress = false;
      elements.sendButton.disabled = false;
    }
  }

  function connectToSender() {
    const code = elements.receiveCodeInput.value.trim();

    if (!code) {
      showStatus("receive", "error", "Per favore, inserisci un codice di sincronizzazione.");
      return;
    }

    if (state.transferInProgress) {
      showStatus("receive", "info", "Un altro trasferimento è già in corso. Attendi il completamento.");
      return;
    }

    state.transferInProgress = true;
    wormhole.receive(code, RELAY_URL);
  }

  function handleStatusChange({ status, message, metadata, fileData }) {
    switch (status) {
      case WormholeStatus.CHECKING_RELAY:
        showStatus("send", "info", message);
        break;
      case WormholeStatus.ENCRYPTING:
        showStatus("send", "info", message);
        break;
      case WormholeStatus.UPLOADING:
        showStatus("send", "info", message);
        break;
      case WormholeStatus.PINNING:
        showStatus("send", "info", message);
        break;
      case WormholeStatus.SENT:
        showStatus("send", "success", message);
        break;
      case WormholeStatus.COMPLETED:
        showStatus(state.activeTab, "success", message);
        window.setTimeout(resetUI, 4000);
        break;
      case WormholeStatus.UNPINNING:
        showStatus("send", "info", message);
        break;
      case WormholeStatus.UNPINNED:
        showStatus("send", "success", message);
        break;
      case WormholeStatus.NOTICE:
        showStatus(state.activeTab, "info", message);
        break;
      case WormholeStatus.ERROR:
        showStatus(state.activeTab, "error", message);
        state.transferInProgress = false;
        if (state.activeTab === "send") {
          elements.sendButton.disabled = false;
        }
        break;
      case WormholeStatus.CONNECTING:
        showStatus("receive", "info", message);
        break;
      case WormholeStatus.FOUND: {
        const sizeInMb = metadata?.size ? (metadata.size / 1024 / 1024).toFixed(2) : "0";
        showStatus(
          "receive",
          "info",
          `Trasferimento trovato: ${metadata?.filename ?? "file"} (${sizeInMb} MB)`
        );
        break;
      }
      case WormholeStatus.DOWNLOADING:
        showStatus("receive", "info", message);
        break;
      case WormholeStatus.DECRYPTING:
        showStatus("receive", "info", message);
        break;
      case WormholeStatus.DOWNLOADED:
        downloadBlob(fileData?.blob, fileData?.filename ?? "download");
        showStatus("receive", "success", message);
        state.transferInProgress = false;
        window.setTimeout(resetUI, 4000);
        break;
      default:
        if (message) {
          showStatus(state.activeTab, "info", message);
        }
        break;
    }
  }

  function handleProgress({ progress }) {
    updateProgress(state.activeTab, progress);
  }

  function showStatus(tab, type, message) {
    const statusContainer = elements.status[tab];
    if (!statusContainer) {
      return;
    }

    const alertType =
      type === "error" ? "alert-error" : type === "success" ? "alert-success" : "alert-info";

    statusContainer.innerHTML = `
      <div class="alert ${alertType} shadow-lg mt-4 text-sm p-3">
        <span>${message}</span>
      </div>
    `;
  }

  function updateProgress(tab, progress) {
    const container = elements.progressContainers[tab];
    const bar = elements.progressBars[tab];

    if (!container || !bar) {
      return;
    }

    container.classList.remove("hidden");
    bar.value = Number(progress ?? 0);
  }

  function resetUI() {
    state.selectedFile = null;
    state.transferInProgress = false;
    state.currentCode = null;

    elements.fileInput.value = "";
    elements.transferCodeDisplay.textContent = "";
    elements.sendPrompt.classList.remove("hidden");
    elements.fileInfoSection.classList.add("hidden");
    elements.codeSection.classList.add("hidden");
    elements.sendButton.disabled = true;

    Object.values(elements.status).forEach((container) => {
      container.innerHTML = "";
    });

    Object.values(elements.progressContainers).forEach((container) => {
      container.classList.add("hidden");
    });

    Object.values(elements.progressBars).forEach((bar) => {
      bar.value = 0;
    });

    elements.receiveCodeInput.value = "";

    switchTab("send");
  }

  function downloadBlob(blob, filename) {
    if (!blob) {
      return;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename || "download";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function getDomElements() {
    return {
      fileInput: document.getElementById("fileInput"),
      sendButton: document.getElementById("send-btn"),
      receiveButton: document.getElementById("receive-btn"),
      sendPrompt: document.getElementById("send-prompt"),
      fileInfoSection: document.getElementById("file-info-section"),
      codeSection: document.getElementById("code-section"),
      fileDetails: document.getElementById("file-details"),
      receiveCodeInput: document.getElementById("receive-code"),
      transferCodeDisplay: document.getElementById("transfer-code"),
      copyCodeButton: document.querySelector('[data-action="copy-code"]'),
      tabButtons: [...document.querySelectorAll("[data-tab-button]")],
      tabPanels: {
        send: document.querySelector('[data-tab-panel="send"]'),
        receive: document.querySelector('[data-tab-panel="receive"]'),
      },
      status: {
        send: document.getElementById("send-status"),
        receive: document.getElementById("receive-status"),
      },
      progressContainers: {
        send: document.getElementById("send-progress"),
        receive: document.getElementById("receive-progress"),
      },
      progressBars: {
        send: document.querySelector("#send-progress progress"),
        receive: document.querySelector("#receive-progress progress"),
      },
    };
  }

  function getFileIcon(type) {
    if (!type) {
      return "📁";
    }
    if (type.startsWith("image/")) return "🖼️";
    if (type.startsWith("video/")) return "🎥";
    if (type.startsWith("audio/")) return "🎵";
    if (type.startsWith("text/")) return "📄";
    if (type.includes("pdf")) return "📑";
    return "📁";
  }

  function formatBytes(size) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = size;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(1)} ${units[unitIndex]}`;
  }
});

function setupGunOptHook(Gun) {
  Gun.on("opt", function opt(ctx) {
    if (ctx.once) {
      return;
    }
    ctx.on("out", function out(msg) {
      const forward = this.to;
      msg.headers = { ...msg.headers, token: "S3RVER" };
      forward.next(msg);
    });
  });
}

