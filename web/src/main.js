import { WormholeCore, WormholeStatus } from '@wormhole/core';
import ZEN from 'zen';
import '../styles/wormhole.css';

const RELAY_URL =
  import.meta.env.VITE_RELAY_URL && import.meta.env.VITE_RELAY_URL !== 'undefined'
    ? import.meta.env.VITE_RELAY_URL
    : 'https://delay.scobrudot.dev';
const AUTH_TOKEN =
  import.meta.env.VITE_AUTH_TOKEN && import.meta.env.VITE_AUTH_TOKEN !== 'undefined'
    ? import.meta.env.VITE_AUTH_TOKEN
    : 'shogun2025';
const MAX_FILE_SIZE = 100 * 1024 * 1024;

export function isFreenetEnvironment() {
  if (typeof window === 'undefined' || !window.location) return false;
  return (
    window.location.port === '7509' ||
    window.location.pathname.includes('/v1/contract/') ||
    window.location.hostname.endsWith('freenet') ||
    window.location.protocol === 'freenet:'
  );
}

let elements = null;
let wormhole = null;
let initPromise = null;

const state = {
  selectedFile: null,
  transferInProgress: false,
  currentCode: null,
  activeTab: 'send',
};

function request(action, payload) {
  return new Promise((resolve) => {
    const onMessage = (event) => {
      if (event.data?.type === 'tunecamp:response' && event.data?.action === action) {
        window.removeEventListener('message', onMessage);
        resolve(event.data.payload);
      }
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'tunecamp:request', action, payload }, '*');
    setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, 3000);
  });
}

const tc = {
  getUser: () => request('getUser'),
  getLibrary: () => request('getLibrary', { limit: 50 }),
};

async function getWormhole() {
  if (wormhole) {
    return wormhole;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    let gunInstance = null;
    const isFreenet = isFreenetEnvironment();

    // In Freenet mode, Gun / Zen is not used: Freenet contracts and gateway are used exclusively
    if (!isFreenet) {
      const zenInstance = ZEN;
      if (zenInstance && typeof zenInstance === 'function') {
        try {
          const defaultPeers = ['https://delay.scobrudot.dev/zen'];
          const peerSet = new Set(defaultPeers);
          gunInstance = new zenInstance({
            peers: Array.from(peerSet),
            localStorage: false,
          });
        } catch (e) {
          console.warn('[Wormhole] Zen init notice:', e);
        }
      }
    }

    wormhole = new WormholeCore({
      gun: gunInstance,
      onStatusChange: handleStatusChange,
      onProgress: handleProgress,
    });

    return wormhole;
  })();

  return initPromise;
}

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;

  if (isLoading) {
    if (!button.dataset.originalContent) {
      button.dataset.originalContent = button.innerHTML;
    }
    button.innerHTML = `<span class="loading loading-spinner loading-xs"></span> <span>${loadingText}</span>`;
    button.disabled = false;
    button.classList.add('pointer-events-none');
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.originalContent) {
      button.innerHTML = button.dataset.originalContent;
      delete button.dataset.originalContent;
    }
    button.classList.remove('pointer-events-none');
    button.removeAttribute('aria-busy');
  }
}

function wireEventListeners() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tabButton));
  });

  elements.sendPrompt.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      elements.sendPrompt.click();
    }
  });

  elements.sendPrompt.addEventListener('click', () => {
    if (state.selectedFile || state.transferInProgress) {
      return;
    }
    elements.fileInput.click();
    updateDropZoneStyle(true);
    window.setTimeout(() => updateDropZoneStyle(false), 200);
  });

  elements.fileInput.addEventListener('change', (event) => {
    handleFileSelect(event.target.files?.[0] ?? null);
  });

  ['dragover', 'dragleave', 'drop'].forEach((eventName) => {
    elements.sendPrompt.addEventListener(eventName, (event) => {
      handleDragEvent(eventName, event);
    });
  });

  elements.btnRemoveFile?.addEventListener('click', () => {
    resetSelectedFile();
  });

  elements.btnPasteCode?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        elements.receiveCodeInput.value = text.trim();
        elements.receiveCodeInput.focus();
      }
    } catch (e) {
      console.warn('Clipboard paste unavailable', e);
    }
  });

  elements.sendButton.addEventListener('click', () => {
    void sendFile();
  });

  elements.copyCodeButton.addEventListener('click', () => {
    void copyCode();
  });

  document.getElementById('btn-new-transfer')?.addEventListener('click', () => {
    resetUI();
  });

  elements.receiveButton.addEventListener('click', () => {
    void connectToSender();
  });

  // TuneCamp SDK Initialization
  tc.getUser().then((user) => {
    if (user) {
      elements.btnFetchLab?.classList.remove('hidden');
    }
  });

  elements.btnFetchLab?.addEventListener('click', async () => {
    setButtonLoading(elements.btnFetchLab, true, 'Loading library...');
    const library = await tc.getLibrary();
    setButtonLoading(elements.btnFetchLab, false);

    if (library && library.tracks && library.tracks.length > 0) {
      elements.labTracks.innerHTML = '';
      library.tracks.forEach((track) => {
        const btn = document.createElement('button');
        btn.className =
          'btn btn-outline border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600 justify-start text-left w-full h-auto py-2.5';
        btn.innerHTML = `<div class="truncate"><span class="font-semibold text-sm">${track.title}</span><br/><span class="text-xs text-zinc-400">${track.artist}</span></div>`;
        btn.onclick = async () => {
          elements.labModal.close();
          showStatus('send', 'info', `Scaricamento traccia: ${track.title}...`);
          try {
            const response = await fetch(track.streamUrl);
            const blob = await response.blob();
            const file = new File(
              [blob],
              `${track.artist} - ${track.title}.mp3`,
              { type: blob.type || 'audio/mpeg', lastModified: Date.now() }
            );
            handleFileSelect(file);
          } catch (e) {
            console.error(e);
            showStatus('send', 'error', 'Errore durante lo scaricamento della traccia dalla libreria.');
          }
        };
        elements.labTracks.appendChild(btn);
      });
      elements.labModal.showModal();
    } else {
      showStatus('send', 'info', 'Libreria vuota o non accessibile.');
    }
  });
}

function handleDragEvent(eventName, event) {
  event.preventDefault();
  event.stopPropagation();

  if (state.selectedFile) {
    return;
  }

  if (eventName === 'dragover') {
    updateDropZoneStyle(true);
  }

  if (eventName === 'dragleave') {
    updateDropZoneStyle(false);
  }

  if (eventName === 'drop') {
    updateDropZoneStyle(false);
    const droppedFile = event.dataTransfer?.files?.[0];
    handleFileSelect(droppedFile ?? null);
  }
}

function switchTab(tab) {
  state.activeTab = tab;

  elements.tabButtons.forEach((button) => {
    const isActive = button.dataset.tabButton === tab;
    button.classList.toggle('tab-active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  Object.entries(elements.tabPanels).forEach(([panelKey, panelElement]) => {
    if (panelElement) {
      panelElement.classList.toggle('hidden', panelKey !== tab);
    }
  });
}

async function copyCode() {
  if (!state.currentCode) {
    showStatus('send', 'info', 'Nessun codice di sincronizzazione disponibile.');
    return;
  }

  const originalHTML = elements.copyCodeButton.innerHTML;

  try {
    await navigator.clipboard.writeText(state.currentCode);
    showStatus('send', 'success', 'Codice copiato negli appunti!');

    elements.copyCodeButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
      </svg>
      <span>Copiato!</span>
    `;
    elements.copyCodeButton.classList.add('border-emerald-500/50');

    setTimeout(() => {
      elements.copyCodeButton.innerHTML = originalHTML;
      elements.copyCodeButton.classList.remove('border-emerald-500/50');
    }, 2000);
  } catch (error) {
    console.error(error);
    showStatus('send', 'error', 'Impossibile copiare il codice automaticamente.');
  }
}

function updateDropZoneStyle(isActive) {
  elements.sendPrompt.classList.toggle('drag-active', isActive);
}

function handleFileSelect(file) {
  if (!file) {
    return;
  }

  if (file.size > MAX_FILE_SIZE) {
    showStatus('send', 'error', 'File troppo grande. Il limite massimo è 100MB.');
    return;
  }

  state.selectedFile = file;
  elements.sendPrompt.classList.add('hidden');
  elements.fileInfoSection.classList.remove('hidden');
  elements.sendButton.disabled = false;
  elements.sendButton.focus();

  const icon = getFileIcon(file.type);
  const formattedSize = formatBytes(file.size);

  elements.fileDetails.innerHTML = '';

  const iconWrapper = document.createElement('div');
  iconWrapper.className =
    'w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xl shrink-0';
  iconWrapper.textContent = icon;

  const textWrapper = document.createElement('div');
  textWrapper.className = 'flex flex-col min-w-0';

  const nameEl = document.createElement('span');
  nameEl.className = 'text-xs sm:text-sm font-medium text-zinc-100 truncate';
  nameEl.textContent = file.name;
  nameEl.title = file.name;

  const metaRow = document.createElement('div');
  metaRow.className = 'flex items-center gap-2 text-[11px] text-zinc-400 mt-0.5';
  metaRow.innerHTML = `<span>${formattedSize}</span> &bull; <span class="font-mono">${file.type || 'Generic file'}</span>`;

  textWrapper.appendChild(nameEl);
  textWrapper.appendChild(metaRow);

  elements.fileDetails.appendChild(iconWrapper);
  elements.fileDetails.appendChild(textWrapper);

  showStatus('send', 'success', 'File pronto per il trasferimento.');
  window.setTimeout(() => {
    if (elements.status.send) elements.status.send.textContent = '';
  }, 2500);
}

function resetSelectedFile() {
  state.selectedFile = null;
  elements.fileInput.value = '';
  elements.fileDetails.innerHTML = '';
  elements.fileInfoSection.classList.add('hidden');
  elements.sendPrompt.classList.remove('hidden');
  elements.sendButton.disabled = true;
}

async function sendFile() {
  if (!state.selectedFile || state.transferInProgress) {
    return;
  }

  state.transferInProgress = true;
  setButtonLoading(elements.sendButton, true, 'Preparing...');

  let instance = null;
  try {
    showStatus('send', 'info', 'Inizializzazione rete in corso...');
    instance = await getWormhole();
    if (!instance) {
      throw new Error('Inizializzazione istanza fallita.');
    }
  } catch (initErr) {
    console.error('Initialization error:', initErr);
    showStatus('send', 'error', 'Errore inizializzazione rete.');
    state.transferInProgress = false;
    setButtonLoading(elements.sendButton, false);
    return;
  }

  const isFreenet = isFreenetEnvironment();
  const selectedMode = isFreenet
    ? 'freenet'
    : (document.querySelector('input[name="transfer-mode"]:checked')?.value || 'p2p');

  try {
    const transferCode = await instance.send({
      file: state.selectedFile,
      filename: state.selectedFile.name,
      size: state.selectedFile.size,
      type: state.selectedFile.type,
      relayUrl: RELAY_URL,
      authToken: AUTH_TOKEN,
      lastModified: state.selectedFile.lastModified,
      mode: selectedMode,
    });

    state.currentCode = transferCode;
    elements.transferCodeDisplay.textContent = transferCode;
    elements.codeSection.classList.remove('hidden');
    elements.fileInfoSection.classList.add('hidden');

    // Dynamic mode-specific badge and instructions
    const isFn = isFreenet;
    const isIpfs = selectedMode === 'ipfs';
    const isP2p = selectedMode === 'p2p';

    const badgeFreenet = document.getElementById('transfer-badge-freenet');
    const badgeWebRtc = document.getElementById('transfer-badge-webrtc');
    const badgeIpfs = document.getElementById('transfer-badge-ipfs');
    const instrFreenet = document.getElementById('code-instruction-freenet');
    const instrWebRtc = document.getElementById('code-instruction-webrtc');
    const instrIpfs = document.getElementById('code-instruction-ipfs');

    if (badgeFreenet) badgeFreenet.classList.toggle('hidden', !isFn);
    if (badgeWebRtc) badgeWebRtc.classList.toggle('hidden', isFn || !isP2p);
    if (badgeIpfs) badgeIpfs.classList.toggle('hidden', isFn || !isIpfs);

    if (instrFreenet) instrFreenet.classList.toggle('hidden', !isFn);
    if (instrWebRtc) instrWebRtc.classList.toggle('hidden', isFn || !isP2p);
    if (instrIpfs) instrIpfs.classList.toggle('hidden', isFn || !isIpfs);

    // On Freenet and IPFS, the upload to the network is 100% complete.
    // The sender's browser does not need to stay open.
    if (isFn || isIpfs) {
      state.transferInProgress = false;
      setButtonLoading(elements.sendButton, false);
    }
  } catch (error) {
    console.error(error);
    showStatus('send', 'error', `Upload fallito: ${error.message ?? 'Errore sconosciuto'}`);
    state.transferInProgress = false;
    setButtonLoading(elements.sendButton, false);
  }
}

async function connectToSender() {
  const code = elements.receiveCodeInput.value.trim();

  if (!code) {
    showStatus('receive', 'error', 'Inserisci un codice di sincronizzazione.');
    return;
  }

  if (state.transferInProgress) {
    showStatus('receive', 'info', 'Un altro trasferimento è già in corso.');
    return;
  }

  state.transferInProgress = true;
  state.currentCode = code;
  setButtonLoading(elements.receiveButton, true, 'Connecting...');

  let instance = null;
  try {
    showStatus('receive', 'info', 'Inizializzazione rete in corso...');
    instance = await getWormhole();
    if (!instance) {
      throw new Error('Inizializzazione istanza fallita.');
    }
  } catch (initErr) {
    console.error('Initialization error:', initErr);
    showStatus('receive', 'error', 'Errore inizializzazione rete.');
    state.transferInProgress = false;
    setButtonLoading(elements.receiveButton, false);
    return;
  }

  const isFreenet = isFreenetEnvironment();
  instance.receive(code, RELAY_URL, isFreenet ? 'freenet' : 'auto');
}

function handleStatusChange({ status, message, metadata, fileData }) {
  switch (status) {
    case WormholeStatus.CHECKING_RELAY:
      showStatus('send', 'info', message);
      break;
    case WormholeStatus.WAITING_PEER:
      showStatus('send', 'info', message);
      break;
    case WormholeStatus.STREAMING_P2P:
      showStatus(state.activeTab, 'info', message);
      break;
    case WormholeStatus.ENCRYPTING:
      showStatus('send', 'info', message);
      break;
    case WormholeStatus.UPLOADING:
      showStatus('send', 'info', message);
      break;
    case WormholeStatus.PINNING:
      showStatus('send', 'info', message);
      break;
    case WormholeStatus.FREENET_UPLOADING_CHUNKS:
    case WormholeStatus.FREENET_PUBLISHING_MANIFEST:
      showStatus('send', 'info', message);
      break;
    case WormholeStatus.FREENET_RESOLVING_MANIFEST:
    case WormholeStatus.FREENET_DOWNLOADING_CHUNKS:
      showStatus('receive', 'info', message);
      break;
    case WormholeStatus.SENT:
      showStatus(
        'send',
        'success',
        isFreenetEnvironment()
          ? 'File cifrato e pubblicato su Freenet! Puoi chiudere la finestra in sicurezza.'
          : message
      );
      break;
    case WormholeStatus.COMPLETED:
      if (fileData?.blob) {
        downloadBlob(fileData.blob, fileData.filename ?? 'download');
      }
      showStatus(state.activeTab, 'success', message);
      setButtonLoading(elements.sendButton, false);
      setButtonLoading(elements.receiveButton, false);
      elements.sendButton.disabled = true;
      window.setTimeout(resetUI, 4000);
      break;
    case WormholeStatus.UNPINNING:
      showStatus('send', 'info', message);
      break;
    case WormholeStatus.UNPINNED:
      showStatus('send', 'success', message);
      break;
    case WormholeStatus.NOTICE:
      showStatus(state.activeTab, 'info', message);
      break;
    case WormholeStatus.ERROR:
      showStatus(state.activeTab, 'error', message);
      state.transferInProgress = false;
      setButtonLoading(elements.sendButton, false);
      setButtonLoading(elements.receiveButton, false);
      if (state.activeTab === 'send') {
        elements.sendButton.disabled = false;
      }
      break;
    case WormholeStatus.CONNECTING:
      showStatus('receive', 'info', message);
      break;
    case WormholeStatus.FOUND: {
      const sizeInMb = metadata?.size ? (metadata.size / 1024 / 1024).toFixed(2) : '0';
      showStatus(
        'receive',
        'info',
        `Trasferimento trovato: ${metadata?.filename ?? 'file'} (${sizeInMb} MB)`
      );
      break;
    }
    case WormholeStatus.DOWNLOADING:
      showStatus('receive', 'info', message);
      break;
    case WormholeStatus.DECRYPTING:
      showStatus('receive', 'info', message);
      break;
    case WormholeStatus.DOWNLOADED:
      downloadBlob(fileData?.blob, fileData?.filename ?? 'download');
      showStatus('receive', 'success', message);
      state.transferInProgress = false;
      setButtonLoading(elements.receiveButton, false);
      elements.receiveButton.disabled = true;
      window.setTimeout(resetUI, 4000);
      break;
    default:
      if (message) {
        showStatus(state.activeTab, 'info', message);
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

  const alertColor =
    type === 'error'
      ? 'bg-red-950/40 border-red-900/40 text-red-200'
      : type === 'success'
      ? 'bg-emerald-950/40 border-emerald-900/40 text-emerald-200'
      : 'bg-zinc-900 border-zinc-800 text-zinc-200';

  const iconSvg =
    type === 'error'
      ? '<svg class="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>'
      : type === 'success'
      ? '<svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>'
      : '<svg class="w-4 h-4 text-zinc-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>';

  statusContainer.textContent = '';

  const alertDiv = document.createElement('div');
  alertDiv.className = `wormhole-alert flex items-center gap-2.5 p-3 text-xs font-medium ${alertColor} shadow-md`;
  alertDiv.innerHTML = `${iconSvg}<span>${message}</span>`;

  statusContainer.appendChild(alertDiv);
}

function updateProgress(tab, progress) {
  const container = elements.progressContainers[tab];
  const bar = elements.progressBars[tab];
  const pctLabel = elements.progressPercentages[tab];

  if (!container || !bar) {
    return;
  }

  const val = Math.round(Number(progress ?? 0));
  container.classList.remove('hidden');
  bar.value = val;
  if (pctLabel) {
    pctLabel.textContent = `${val}%`;
  }
}

function resetUI() {
  state.selectedFile = null;
  state.transferInProgress = false;
  state.currentCode = null;

  if (!elements) return;

  elements.fileInput.value = '';
  elements.transferCodeDisplay.textContent = '';
  elements.sendPrompt.classList.remove('hidden');
  elements.fileInfoSection.classList.add('hidden');
  elements.codeSection.classList.add('hidden');
  setButtonLoading(elements.sendButton, false);
  setButtonLoading(elements.receiveButton, false);
  elements.sendButton.disabled = true;

  Object.values(elements.status).forEach((container) => {
    if (container) container.textContent = '';
  });

  Object.values(elements.progressContainers).forEach((container) => {
    if (container) container.classList.add('hidden');
  });

  Object.values(elements.progressBars).forEach((bar) => {
    if (bar) bar.value = 0;
  });

  Object.values(elements.progressPercentages).forEach((pct) => {
    if (pct) pct.textContent = '0%';
  });

  elements.receiveCodeInput.value = '';
  if (isFreenetEnvironment()) {
    const fnRadio = document.getElementById('mode-freenet');
    if (fnRadio) fnRadio.checked = true;
  } else {
    const p2pRadio = document.getElementById('mode-p2p');
    if (p2pRadio) p2pRadio.checked = true;
  }
  switchTab('send');
}

function downloadBlob(blob, filename) {
  if (!blob) {
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'download';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getDomElements() {
  return {
    fileInput: document.getElementById('fileInput'),
    sendButton: document.getElementById('send-btn'),
    receiveButton: document.getElementById('receive-btn'),
    sendPrompt: document.getElementById('send-prompt'),
    fileInfoSection: document.getElementById('file-info-section'),
    codeSection: document.getElementById('code-section'),
    fileDetails: document.getElementById('file-details'),
    btnRemoveFile: document.getElementById('btn-remove-file'),
    receiveCodeInput: document.getElementById('receive-code'),
    btnPasteCode: document.getElementById('btn-paste-code'),
    transferCodeDisplay: document.getElementById('transfer-code'),
    copyCodeButton: document.querySelector('[data-action="copy-code"]'),
    tabButtons: [...document.querySelectorAll('[data-tab-button]')],
    tabPanels: {
      send: document.querySelector('[data-tab-panel="send"]'),
      receive: document.querySelector('[data-tab-panel="receive"]'),
    },
    status: {
      send: document.getElementById('send-status'),
      receive: document.getElementById('receive-status'),
    },
    progressContainers: {
      send: document.getElementById('send-progress'),
      receive: document.getElementById('receive-progress'),
    },
    progressBars: {
      send: document.querySelector('#send-progress progress'),
      receive: document.querySelector('#receive-progress progress'),
    },
    progressPercentages: {
      send: document.getElementById('send-progress-pct'),
      receive: document.getElementById('receive-progress-pct'),
    },
    btnFetchLab: document.getElementById('btn-fetch-lab'),
    labModal: document.getElementById('lab-modal'),
    labTracks: document.getElementById('lab-tracks'),
  };
}

function getFileIcon(type) {
  if (!type) return '📁';
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('video/')) return '🎥';
  if (type.startsWith('audio/')) return '🎵';
  if (type.startsWith('text/')) return '📄';
  if (type.includes('pdf')) return '📑';
  if (type.includes('zip') || type.includes('compressed') || type.includes('tar')) return '📦';
  return '📁';
}

function formatBytes(size) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function switchView(viewName) {
  const validViews = ['transfer', 'about', 'cli'];
  const targetView = validViews.includes(viewName) ? viewName : 'transfer';

  const views = {
    transfer: document.getElementById('view-transfer'),
    about: document.getElementById('view-about'),
    cli: document.getElementById('view-cli'),
  };

  Object.entries(views).forEach(([name, el]) => {
    if (el) {
      el.classList.toggle('hidden', name !== targetView);
    }
  });

  document.querySelectorAll('[data-view-nav]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.viewNav === targetView);
  });

  if (window.location.hash.replace('#', '') !== targetView) {
    history.pushState(null, '', `#${targetView}`);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function setupViewNavigation() {
  document.querySelectorAll('[data-view-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView(btn.dataset.viewNav);
    });
  });

  document.querySelectorAll('[data-view-target]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(el.dataset.viewTarget);
    });
  });

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '');
    if (hash && ['transfer', 'about', 'cli'].includes(hash)) {
      switchView(hash);
    }
  });

  const initialHash = window.location.hash.replace('#', '');
  if (initialHash && ['transfer', 'about', 'cli'].includes(initialHash)) {
    switchView(initialHash);
  }
}

function setupCopyButtons() {
  document.querySelectorAll('[data-copy-text]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.dataset.copyText;
      if (!textToCopy) return;

      const originalHTML = btn.innerHTML;
      try {
        await navigator.clipboard.writeText(textToCopy);
        btn.classList.add('copied');
        btn.innerHTML = `
          <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>Copiato!</span>
        `;
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = originalHTML;
        }, 2000);
      } catch (err) {
        console.warn('Clipboard write error', err);
      }
    });
  });
}

function applyEnvironmentMode() {
  const isFreenet = isFreenetEnvironment();

  document.querySelectorAll('[data-env-show]').forEach((el) => {
    const targetEnv = el.dataset.envShow;
    if (targetEnv === 'freenet') {
      el.classList.toggle('hidden', !isFreenet);
    } else if (targetEnv === 'web') {
      el.classList.toggle('hidden', isFreenet);
    }
  });

  const badge = document.getElementById('protocol-badge');
  const fnRadio = document.getElementById('mode-freenet');
  const p2pRadio = document.getElementById('mode-p2p');
  const modeSelector = document.getElementById('routing-mode-selector');
  const fnBanner = document.getElementById('freenet-mode-banner');

  if (isFreenet) {
    if (badge) {
      badge.textContent = 'Freenet Native';
      badge.className = 'text-zinc-400 font-mono text-[11px] tracking-wide bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800';
    }
    if (fnRadio) {
      fnRadio.checked = true;
    }
    if (modeSelector) {
      modeSelector.classList.add('hidden');
    }
    if (fnBanner) {
      fnBanner.classList.remove('hidden');
    }
    document.title = 'FreeHole — Asynchronous Sovereign File Transfer on Freenet';
  } else {
    if (badge) {
      badge.textContent = 'WebRTC & IPFS';
      badge.className = 'text-zinc-400 font-mono text-[11px] tracking-wide bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800';
    }
    if (p2pRadio) {
      p2pRadio.checked = true;
    }
    if (modeSelector) {
      modeSelector.classList.remove('hidden');
    }
    if (fnBanner) {
      fnBanner.classList.add('hidden');
    }
    document.title = 'FreeHole — Decentralized P2P & IPFS File Transfer';
  }
}

function setup() {
  elements = getDomElements();
  wireEventListeners();
  setupViewNavigation();
  setupCopyButtons();
  applyEnvironmentMode();
  resetUI();

  getWormhole().catch((e) => console.warn('Wormhole pre-init notice:', e));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
