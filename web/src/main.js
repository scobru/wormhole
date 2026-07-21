import { WormholeCore, WormholeStatus, generateCode } from '@wormhole/core';
import ZEN from 'zen';
import 'zen/lib/webrtc.js';

const RELAY_URL = import.meta.env.VITE_RELAY_URL;
const AUTH_TOKEN = import.meta.env.VITE_AUTH_TOKEN;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

document.addEventListener('DOMContentLoaded', async () => {
  const elements = getDomElements();
  const state = {
    selectedFile: null,
    transferInProgress: false,
    currentCode: null,
    activeTab: 'send',
  };

  wireEventListeners();
  resetUI();

  let wormhole = null;

  const initPromise = (async () => {
    const zenInstance = ZEN;

    if (!zenInstance) {
      console.error('Zen non è stato caricato correttamente.');
      return;
    }

    const defaultPeers = [
      'https://delay.scobrudot.dev/zen'
    ];

    const peerSet = new Set(defaultPeers);

    const gunInstance = new zenInstance({
      peers: Array.from(peerSet),
      localStorage: false,
    });

    wormhole = new WormholeCore({
      gun: gunInstance,
      onStatusChange: handleStatusChange,
      onProgress: handleProgress,
    });
  })();

  function setButtonLoading(button, isLoading, loadingText) {
    if (!button) return;

    if (isLoading) {
      if (!button.dataset.originalContent) {
        button.dataset.originalContent = button.innerHTML;
      }
      button.innerHTML = `<span class="loading loading-spinner loading-sm"></span> ${loadingText}`;
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

    elements.sendButton.addEventListener('click', () => {
      void sendFile();
    });
    elements.copyCodeButton.addEventListener('click', () => {
      void copyCode();
    });
    elements.receiveButton.addEventListener('click', () => {
      connectToSender();
    });

    elements.chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void sendChatMessage();
    });

    elements.createChatBtn.addEventListener('click', () => {
      void createChatOnly();
    });

    elements.joinChatBtn.addEventListener('click', () => {
      void joinChatOnly();
    });

    elements.fullscreenBtn.addEventListener('click', () => {
      elements.chatSection.classList.toggle('fullscreen');
      // Scroll to bottom after resizing
      setTimeout(() => {
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
      }, 100);
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
      panelElement.classList.toggle('hidden', panelKey !== tab);
    });
  }

  async function copyCode() {
    if (!state.currentCode) {
      showStatus('send', 'info', '📋 Nessun codice disponibile al momento.');
      return;
    }

    const originalText = elements.copyCodeButton.textContent;

    try {
      await navigator.clipboard.writeText(state.currentCode);
      showStatus('send', 'info', '📋 Codice copiato negli appunti!');

      elements.copyCodeButton.textContent = 'Copiato! ✅';
      elements.copyCodeButton.classList.add('pointer-events-none');
      elements.copyCodeButton.classList.remove('btn-accent');
      elements.copyCodeButton.classList.add('btn-success');

      setTimeout(() => {
        elements.copyCodeButton.textContent = originalText;
        elements.copyCodeButton.classList.remove('pointer-events-none');
        elements.copyCodeButton.classList.remove('btn-success');
        elements.copyCodeButton.classList.add('btn-accent');
      }, 2000);
    } catch (error) {
      console.error(error);
      showStatus('send', 'error', '❌ Impossibile copiare il codice.');

      elements.copyCodeButton.textContent = 'Errore ❌';
      elements.copyCodeButton.classList.add('pointer-events-none');
      elements.copyCodeButton.classList.remove('btn-accent');
      elements.copyCodeButton.classList.add('btn-error');

      setTimeout(() => {
        elements.copyCodeButton.textContent = originalText;
        elements.copyCodeButton.classList.remove('pointer-events-none');
        elements.copyCodeButton.classList.remove('btn-error');
        elements.copyCodeButton.classList.add('btn-accent');
      }, 2000);
    }
  }

  function updateDropZoneStyle(isActive) {
    const highlightClasses = ['bg-accent', 'bg-opacity-10'];
    highlightClasses.forEach((className) => {
      elements.sendPrompt.classList.toggle(className, isActive);
    });
  }

  function handleFileSelect(file) {
    if (!file) {
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      showStatus('send', 'error', '❌ File troppo grande. Il limite è 100MB.');
      return;
    }

    state.selectedFile = file;
    elements.sendPrompt.classList.add('hidden');
    elements.fileInfoSection.classList.remove('hidden');
    elements.sendButton.disabled = false;
    elements.sendButton.focus();

    const icon = getFileIcon(file.type);
    const formattedSize = formatBytes(file.size);
    // Securely update file details using DOM manipulation
    elements.fileDetails.textContent = ''; // Clear previous content

    const fileHeader = document.createElement('div');
    fileHeader.className = 'flex items-center gap-2';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'text-2xl';
    iconSpan.textContent = icon;

    const nameStrong = document.createElement('strong');
    nameStrong.className = 'text-accent break-all';
    nameStrong.textContent = file.name;

    fileHeader.appendChild(iconSpan);
    fileHeader.appendChild(nameStrong);

    const fileMeta = document.createElement('div');
    fileMeta.className = 'mt-2 text-sm text-gray-400';

    const sizeRow = document.createElement('div');
    sizeRow.className = 'flex items-center gap-2';
    const sizeSpan = document.createElement('span');
    sizeSpan.textContent = `📏 Dimensione: ${formattedSize}`;
    sizeRow.appendChild(sizeSpan);

    const typeRow = document.createElement('div');
    typeRow.className = 'flex items-center gap-2 mt-1';
    const typeSpan = document.createElement('span');
    typeSpan.textContent = `📋 Tipo: ${file.type || 'Sconosciuto'}`;
    typeRow.appendChild(typeSpan);

    fileMeta.appendChild(sizeRow);
    fileMeta.appendChild(typeRow);

    elements.fileDetails.appendChild(fileHeader);
    elements.fileDetails.appendChild(fileMeta);

    showStatus('send', 'success', '✅ File selezionato con successo!');
    window.setTimeout(() => {
      elements.status.send.textContent = '';
    }, 3000);
  }

  async function sendFile() {
    if (!state.selectedFile || state.transferInProgress) {
      return;
    }

    if (!wormhole) {
      showStatus('send', 'info', 'Inizializzazione in corso...');
      await initPromise;
      if (!wormhole) {
        showStatus('send', 'error', 'Inizializzazione fallita.');
        return;
      }
    }

    state.transferInProgress = true;
    setButtonLoading(elements.sendButton, true, 'Transferring...');

    const selectedMode = document.querySelector('input[name="transfer-mode"]:checked')?.value || 'p2p';

    try {
      const transferCode = await wormhole.send({
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

      startChat(transferCode);
    } catch (error) {
      console.error(error);
      showStatus('send', 'error', `❌ Upload fallito: ${error.message ?? 'Errore sconosciuto'}`);
      state.transferInProgress = false;
      setButtonLoading(elements.sendButton, false);
    }
  }

  async function connectToSender() {
    const code = elements.receiveCodeInput.value.trim();

    if (!code) {
      showStatus('receive', 'error', 'Per favore, inserisci un codice di sincronizzazione.');
      return;
    }

    if (state.transferInProgress) {
      showStatus('receive', 'info', 'Un altro trasferimento è già in corso. Attendi il completamento.');
      return;
    }

    if (!wormhole) {
      showStatus('receive', 'info', 'Inizializzazione in corso...');
      await initPromise;
      if (!wormhole) {
        showStatus('receive', 'error', 'Inizializzazione fallita.');
        return;
      }
    }

    state.transferInProgress = true;
    state.currentCode = code;
    setButtonLoading(elements.receiveButton, true, 'Connecting...');
    wormhole.receive(code, RELAY_URL);

    startChat(code);
  }

  async function createChatOnly() {
    if (!wormhole) {
      await initPromise;
    }

    const code = generateCode();
    state.currentCode = code;
    state.chatRole = elements.nicknameInput.value.trim() || 'User A';

    showStatus('chat-only', 'success', `✅ Chat creata! Codice: ${code}`);
    startChat(code);

    // Announce presence in Gun for this code so the other side can find it if they are looking
    wormhole.gun.get(code).put({ type: 'chat-only', createdAt: Date.now() });
  }

  async function joinChatOnly() {
    const code = elements.chatOnlyInput.value.trim();
    if (!code) {
      showStatus('chat-only', 'error', 'Inserisci un codice per unirti.');
      return;
    }

    if (!wormhole) {
      await initPromise;
    }

    state.currentCode = code;
    state.chatRole = elements.nicknameInput.value.trim() || 'User B';
    showStatus('chat-only', 'info', `Connessione alla chat: ${code}...`);
    startChat(code);
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
      case WormholeStatus.SENT:
        showStatus('send', 'success', message);
        break;
      case WormholeStatus.COMPLETED:
        showStatus(state.activeTab, 'success', message);
        setButtonLoading(elements.sendButton, false);
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

    const alertType =
      type === 'error' ? 'alert-error' : type === 'success' ? 'alert-success' : 'alert-info';

    // Securely create status message using DOM manipulation to prevent XSS
    statusContainer.textContent = ''; // Clear previous content

    const alertDiv = document.createElement('div');
    alertDiv.className = `alert ${alertType} shadow-lg mt-4 text-sm p-3`;

    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;

    alertDiv.appendChild(messageSpan);
    statusContainer.appendChild(alertDiv);
  }

  function updateProgress(tab, progress) {
    const container = elements.progressContainers[tab];
    const bar = elements.progressBars[tab];

    if (!container || !bar) {
      return;
    }

    container.classList.remove('hidden');
    bar.value = Number(progress ?? 0);
  }

  function resetUI() {
    state.selectedFile = null;
    state.transferInProgress = false;
    state.currentCode = null;
    state.chatRole = null;

    elements.fileInput.value = '';
    elements.transferCodeDisplay.textContent = '';
    elements.sendPrompt.classList.remove('hidden');
    elements.fileInfoSection.classList.add('hidden');
    elements.codeSection.classList.add('hidden');
    setButtonLoading(elements.sendButton, false);
    setButtonLoading(elements.receiveButton, false);
    elements.sendButton.disabled = true;

    Object.values(elements.status).forEach((container) => {
      container.textContent = '';
    });

    Object.values(elements.progressContainers).forEach((container) => {
      container.classList.add('hidden');
    });

    Object.values(elements.progressBars).forEach((bar) => {
      bar.value = 0;
    });

    elements.receiveCodeInput.value = '';
    elements.chatOnlyInput.value = '';
    elements.nicknameInput.value = '';

    elements.chatSection.classList.add('hidden');
    elements.chatMessages.innerHTML = '';
    elements.chatInput.value = '';
    elements.chatSection.classList.remove('fullscreen');

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

  function startChat(code) {
    elements.chatSection.classList.remove('hidden');
    elements.chatMessages.innerHTML = '<div class="text-center text-xs opacity-40 py-2">Messages are end-to-end encrypted</div>';

    const seen = new Set();

    wormhole.gun
      .get('wormhole/messages')
      .get(code)
      .map()
      .on(async (data, key) => {
        if (data && data.content && !seen.has(key)) {
          seen.add(key);
          try {
            // Check if ZEN.decrypt is available, otherwise it might be in the core
            // In the CLI it's ZEN.decrypt
            const decrypted = await ZEN.decrypt(data.content, code);
            if (decrypted) {
              renderMessage(data.sender, decrypted, data.timestamp);
            }
          } catch (e) {
            console.warn('Could not decrypt message:', e);
          }
        }
      });
  }

  async function sendChatMessage() {
    const message = elements.chatInput.value.trim();
    if (!message || !state.currentCode) return;

    elements.chatInput.value = '';
    let sender;
    if (state.activeTab === 'chat-only') {
      sender = state.chatRole || 'User';
    } else {
      sender = state.activeTab === 'send' ? 'Sender' : 'Receiver';
    }

    try {
      const encrypted = await ZEN.encrypt(message, state.currentCode);

      wormhole.gun.get('wormhole/messages').get(state.currentCode).set({
        content: encrypted,
        sender: sender,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('Error sending message:', error);
      showStatus(state.activeTab, 'error', '❌ Errore invio messaggio');
    }
  }

  function renderMessage(sender, text, timestamp) {
    const isMe = (state.activeTab === 'send' && sender === 'Sender') ||
      (state.activeTab === 'receive' && sender === 'Receiver') ||
      (state.activeTab === 'chat-only' && sender === state.chatRole);

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat ${isMe ? 'chat-end' : 'chat-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`;

    const header = document.createElement('div');
    header.className = 'chat-header opacity-50 text-xs mb-1 flex items-center gap-2';
    header.textContent = sender;

    const time = document.createElement('time');
    time.className = 'text-[10px] opacity-40';
    time.textContent = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    header.appendChild(time);

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble shadow-md max-w-[85%] text-sm ${isMe ? 'chat-bubble-accent' : 'chat-bubble-secondary'}`;
    bubble.textContent = text;

    messageDiv.appendChild(header);
    messageDiv.appendChild(bubble);

    elements.chatMessages.appendChild(messageDiv);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
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
      receiveCodeInput: document.getElementById('receive-code'),
      transferCodeDisplay: document.getElementById('transfer-code'),
      copyCodeButton: document.querySelector('[data-action="copy-code"]'),
      tabButtons: [...document.querySelectorAll('[data-tab-button]')],
      tabPanels: {
        send: document.querySelector('[data-tab-panel="send"]'),
        receive: document.querySelector('[data-tab-panel="receive"]'),
        'chat-only': document.querySelector('[data-tab-panel="chat-only"]'),
      },
      status: {
        send: document.getElementById('send-status'),
        receive: document.getElementById('receive-status'),
        'chat-only': document.getElementById('chat-only-status'),
      },
      progressContainers: {
        send: document.getElementById('send-progress'),
        receive: document.getElementById('receive-progress'),
      },
      progressBars: {
        send: document.querySelector('#send-progress progress'),
        receive: document.querySelector('#receive-progress progress'),
      },
      chatSection: document.getElementById('chat-section'),
      chatMessages: document.getElementById('chat-messages'),
      chatInput: document.getElementById('chat-input'),
      chatForm: document.getElementById('chat-form'),
      createChatBtn: document.getElementById('create-chat-btn'),
      joinChatBtn: document.getElementById('join-chat-btn'),
      chatOnlyInput: document.getElementById('chat-only-code'),
      nicknameInput: document.getElementById('chat-nickname'),
      fullscreenBtn: document.getElementById('fullscreen-chat-btn'),
    };
  }

  function getFileIcon(type) {
    if (!type) {
      return '📁';
    }
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎥';
    if (type.startsWith('audio/')) return '🎵';
    if (type.startsWith('text/')) return '📄';
    if (type.includes('pdf')) return '📑';
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
});

// Zen handles headers and authentication differently, skipping Gun-specific opt hook


