// Removed shogun-relays dependency logic

// Shared config
const CHUNK_SIZE = 65536; // 64KB chunks
const ENCRYPTION_CONFIG = {
  saltLength: 16,
  ivLength: 12,
  iterations: 150000,
  hash: 'SHA-256',
  algorithm: 'AES-GCM',
  keyLength: 256,
};

const textEncoder = new TextEncoder();

export const WormholeStatus = Object.freeze({
  CHECKING_RELAY: 'checking-relay',
  ENCRYPTING: 'encrypting',
  UPLOADING: 'uploading',
  PINNING: 'pinning',
  SENT: 'sent',
  UNPINNING: 'unpinning',
  UNPINNED: 'unpinned',
  COMPLETED: 'completed',
  CONNECTING: 'connecting',
  FOUND: 'found',
  DOWNLOADING: 'downloading',
  DECRYPTING: 'decrypting',
  DOWNLOADED: 'downloaded',
  ERROR: 'error',
  NOTICE: 'notice',
  WAITING_PEER: 'waiting-peer',
  STREAMING_P2P: 'streaming-p2p',
});

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  // Node.js fallback
  return Buffer.from(bytes).toString('base64');
}

function base64ToUint8Array(base64) {
  if (typeof base64 !== 'string' || base64.trim() === '') {
    throw new Error('Metadati di cifratura mancanti o non validi.');
  }
  const sanitized = base64.replace(/[\r\n\s]/g, '');
  try {
    if (typeof atob === 'function') {
      const binary = atob(sanitized);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    return Uint8Array.from(Buffer.from(sanitized, 'base64'));
  } catch (error) {
    throw new Error('Metadati di cifratura corrotti (base64 non valido).');
  }
}

function normalizeToUint8Array(value, label) {
  if (!value && value !== 0) {
    throw new Error(`Metadati di cifratura incompleti: ${label} assente.`);
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (Array.isArray(value)) {
    return new Uint8Array(value);
  }

  if (typeof value === 'string') {
    return base64ToUint8Array(value);
  }

  if (typeof value === 'object') {
    const numericKeys = Object.keys(value)
      .filter((key) => !Number.isNaN(Number(key)))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length > 0) {
      return new Uint8Array(numericKeys.map((key) => value[key]));
    }
  }

  throw new Error(`Formato metadati di cifratura non supportato per ${label}.`);
}

function parseSerializedMetadata(serialized) {
  if (typeof serialized !== 'string' || serialized.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(serialized);
  } catch (error) {
    console.warn('Impossibile parsare metadati di cifratura serializzati:', error);
    return null;
  }
}

function buildEncryptionMetadata(source) {
  if (!source || source.encrypted === false) {
    return null;
  }

  let base = null;

  if (source.encryption) {
    if (typeof source.encryption === 'string') {
      base = parseSerializedMetadata(source.encryption);
    } else if (typeof source.encryption === 'object') {
      base = source.encryption;
    }
  }

  if (!base) {
    base = parseSerializedMetadata(source.encryptionSerialized);
  }

  if (!base || typeof base !== 'object') {
    base = {};
  }

  const metadata = {
    version: base.version ?? source.encryptionVersion ?? 1,
    algorithm: base.algorithm ?? source.encryptionAlgorithm ?? ENCRYPTION_CONFIG.algorithm,
    iv: base.iv ?? source.encryptionIv,
    salt: base.salt ?? source.encryptionSalt,
    iterations: base.iterations ?? source.encryptionIterations ?? ENCRYPTION_CONFIG.iterations,
    keyLength: base.keyLength ?? source.encryptionKeyLength ?? ENCRYPTION_CONFIG.keyLength,
    hash: base.hash ?? source.encryptionHash ?? ENCRYPTION_CONFIG.hash,
    encryptedFilename: base.encryptedFilename ?? source.encryptionEncryptedFilename,
    originalName: base.originalName ?? source.encryptionOriginalName ?? source.filename,
  };

  if (!metadata.iv || !metadata.salt) {
    return null;
  }

  return metadata;
}

function hasEncryptionMetadata(data) {
  if (!data || !data.encrypted) {
    return true;
  }
  return Boolean(buildEncryptionMetadata(data));
}

async function deriveKeyFromCode(code, saltBytes, iterations = ENCRYPTION_CONFIG.iterations) {
  const salt = saltBytes instanceof Uint8Array ? saltBytes : new Uint8Array(saltBytes);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(code),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: ENCRYPTION_CONFIG.hash,
    },
    keyMaterial,
    {
      name: ENCRYPTION_CONFIG.algorithm,
      length: ENCRYPTION_CONFIG.keyLength,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptFileWithCode(file, code, fallbackName, fallbackLastModified) {
  const normalizedFileName =
    typeof file?.name === 'string' && file.name.trim()
      ? file.name.trim()
      : typeof fallbackName === 'string' && fallbackName.trim()
        ? fallbackName.trim()
        : 'file';

  const lastModified =
    typeof file?.lastModified === 'number'
      ? file.lastModified
      : typeof fallbackLastModified === 'number'
        ? fallbackLastModified
        : Date.now();

  const salt = crypto.getRandomValues(new Uint8Array(ENCRYPTION_CONFIG.saltLength));
  const iv = crypto.getRandomValues(new Uint8Array(ENCRYPTION_CONFIG.ivLength));

  const key = await deriveKeyFromCode(code, salt);
  const fileBuffer = await file.arrayBuffer();
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: ENCRYPTION_CONFIG.algorithm,
      iv,
    },
    key,
    fileBuffer
  );

  const encryptedFilename = `${normalizedFileName}.enc`;

  let encryptedFile;
  if (typeof File === 'function') {
    encryptedFile = new File([encryptedBuffer], encryptedFilename, {
      type: 'application/octet-stream',
      lastModified,
    });
  } else {
    encryptedFile = new Blob([encryptedBuffer], { type: 'application/octet-stream' });
    try {
      Object.defineProperty(encryptedFile, 'name', {
        value: encryptedFilename,
        configurable: true,
      });
    } catch {
      // ignore
    }
    try {
      Object.defineProperty(encryptedFile, 'lastModified', {
        value: lastModified,
        configurable: true,
      });
    } catch {
      // ignore
    }
  }

  return {
    encryptedFile,
    encryptionMetadata: {
      version: 1,
      algorithm: ENCRYPTION_CONFIG.algorithm,
      iv: arrayBufferToBase64(iv),
      salt: arrayBufferToBase64(salt),
      iterations: ENCRYPTION_CONFIG.iterations,
      keyLength: ENCRYPTION_CONFIG.keyLength,
      hash: ENCRYPTION_CONFIG.hash,
      encryptedFilename,
      originalName: normalizedFileName,
    },
  };
}

async function decryptArrayBufferWithCode(encryptedBuffer, code, metadata) {
  const ivBytes = normalizeToUint8Array(metadata.iv, 'IV');
  const saltBytes = normalizeToUint8Array(metadata.salt, 'salt');

  const key = await deriveKeyFromCode(
    code,
    saltBytes,
    metadata.iterations || ENCRYPTION_CONFIG.iterations
  );

  try {
    return await crypto.subtle.decrypt(
      {
        name: metadata.algorithm || ENCRYPTION_CONFIG.algorithm,
        iv: ivBytes,
      },
      key,
      encryptedBuffer
    );
  } catch (error) {
    throw new Error('Impossibile decifrare il file. Verifica il codice inserito e riprova.');
  }
}

/**
 * Generates a human-readable, mnemonic code.
 * @returns {string} The generated code, e.g., "7-brave-fire".
 */
function generateCode() {
  const adjectives = [
    'quick',
    'lazy',
    'happy',
    'bright',
    'calm',
    'wild',
    'gentle',
    'brave',
    'clever',
    'kind',
  ];
  const nouns = [
    'cat',
    'dog',
    'bird',
    'fish',
    'tree',
    'star',
    'moon',
    'rock',
    'wave',
    'fire',
  ];
  const numbers = Math.floor(Math.random() * 100);

  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];

  return `${numbers}-${adj}-${noun}`;
}

/**
 * Splits a base64 string into chunks.
 * @param {string} base64Data - The base64 encoded data string.
 * @returns {string[]} An array of base64 chunks.
 */
function base64ToChunks(base64Data) {
  const chunks = [];
  for (let i = 0; i < base64Data.length; i += CHUNK_SIZE) {
    chunks.push(base64Data.substring(i, i + CHUNK_SIZE));
  }
  return chunks;
}

async function readStreamToBuffer(stream, totalSize, onProgress) {
  const reader = stream.getReader();
  let receivedLength = 0;

  // If we know the size, pre-allocate. Otherwise start small/empty.
  let buffer = totalSize ? new Uint8Array(totalSize) : new Uint8Array(0);
  let chunks = []; // Fallback if size is unknown or exceeded
  let useChunks = !totalSize;
  let reading = true;
  while (reading) {
    const { done, value } = await reader.read();
    if (done) {
      reading = false;
      break;
    }

    const chunkLength = value.length;

    if (!useChunks) {
      // Check if we have space
      if (receivedLength + chunkLength <= buffer.length) {
        buffer.set(value, receivedLength);
      } else {
        // Overflow: switch to chunks strategy for the rest
        useChunks = true;
        // Copy what we have so far into chunks
        if (receivedLength > 0) {
          chunks.push(buffer.subarray(0, receivedLength));
        }
        chunks.push(value);
        buffer = null; // release reference to large buffer
      }
    } else {
      chunks.push(value);
    }

    receivedLength += chunkLength;
    if (onProgress && totalSize) {
      const progress = Math.round((receivedLength / totalSize) * 100);
      onProgress({ progress, loaded: receivedLength, total: totalSize });
    }
  }

  if (useChunks) {
    // Concatenate chunks
    const combined = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      combined.set(chunk, position);
      position += chunk.length;
    }
    return combined;
  }

  // If we pre-allocated but received less, slice it.
  if (receivedLength < buffer.length) {
    return buffer.subarray(0, receivedLength);
  }

  return buffer;
}

export class WormholeCore {
  constructor(options = {}) {
    if (!options.gun) {
      throw new Error('A gun instance must be provided via the "gun" option.');
    }
    this.gun = options.gun;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onProgress = options.onProgress || (() => {});
  }

  async send({ file, filename, size, type, relayUrl, authToken, lastModified, mode = 'p2p' }) {
    const code = generateCode();

    let encryptedFile;
    let encryptionMetadata;

    try {
      this.onStatusChange({
        code,
        status: WormholeStatus.ENCRYPTING,
        message: 'Cifratura del file in corso...',
      });

      const fallbackLastModified =
        typeof lastModified === 'number'
          ? lastModified
          : typeof file?.lastModified === 'number'
            ? file.lastModified
            : undefined;

      const encryptionResult = await encryptFileWithCode(
        file,
        code,
        filename,
        fallbackLastModified
      );
      encryptedFile = encryptionResult.encryptedFile;
      encryptionMetadata = encryptionResult.encryptionMetadata;
    } catch (error) {
      console.error('Errore durante la cifratura:', error);
      this.onStatusChange({
        code,
        status: WormholeStatus.ERROR,
        message: `Cifratura fallita: ${error.message}`,
      });
      throw error;
    }

    const serializedEncryption = JSON.stringify(encryptionMetadata);

    if (mode === 'p2p') {
      const CHUNK_SIZE = 32768; // 32KB per chunk for WebRTC P2P
      const arrayBuffer = await encryptedFile.arrayBuffer();
      const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);

      const transferData = {
        filename,
        size,
        type,
        mode: 'p2p',
        totalChunks,
        createdAt: Date.now(),
        encrypted: true,
        encryptedSize: encryptedFile.size,
        encryptionSerialized: serializedEncryption,
      };

      this.gun.get('shogun/wormhole').get('transfers').get(code).put({
        createdAt: transferData.createdAt,
      });

      this.gun.get(code).put(transferData);

      this.onStatusChange({
        code,
        status: WormholeStatus.WAITING_PEER,
        message: 'File cifrato pronto! In attesa che il ricevente inserisca il codice...',
      });

      let streamingStarted = false;

      const startP2PStreaming = async () => {
        if (streamingStarted) return;
        streamingStarted = true;

        this.onStatusChange({
          code,
          status: WormholeStatus.STREAMING_P2P,
          message: `Trasferimento P2P via WebRTC in corso (${totalChunks} chunk)...`,
        });

        const chunksNode = this.gun.get(`${code}-chunks`);

        for (let i = 0; i < totalChunks; i += 1) {
          const slice = arrayBuffer.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          const base64 = arrayBufferToBase64(slice);

          chunksNode.get(String(i)).put({
            index: i,
            data: base64,
          });

          const progress = Math.round(((i + 1) / totalChunks) * 100);
          this.onProgress({ progress, loaded: i + 1, total: totalChunks });

          if (i % 8 === 0) {
            await new Promise((r) => setTimeout(r, 4));
          }
        }

        this.gun.get(`${code}-complete`).put({ complete: true, timestamp: Date.now() });

        this.onStatusChange({
          code,
          status: WormholeStatus.SENT,
          message: 'Tutti i dati P2P inviati! In attesa della conferma dal ricevente...',
        });
      };

      // Listen for receiver ready signal
      this.gun.get(`${code}-ready`).on((readyData) => {
        if (readyData && readyData.ready) {
          void startP2PStreaming();
        }
      });

      // Monitor for completion
      const completionHandler = async (data) => {
        if (data && data.status === 'completed') {
          this.gun.get(`${code}-received`).off(completionHandler);

          this.onStatusChange({
            code,
            status: WormholeStatus.COMPLETED,
            message: 'Trasferimento P2P completato dal ricevente!',
          });
        }
      };
      this.gun.get(`${code}-received`).on(completionHandler);

      return code;
    }

    // Default: IPFS Relay mode
    this.onStatusChange({
      code,
      status: WormholeStatus.CHECKING_RELAY,
      message: 'Verifica connessione al relay IPFS...',
    });

    try {
      const healthCheck = await fetch(`${relayUrl}/health`);
      if (!healthCheck.ok) {
        throw new Error('Relay IPFS non raggiungibile');
      }
    } catch (error) {
      this.onStatusChange({
        code,
        status: WormholeStatus.ERROR,
        message: `Errore di connessione al relay IPFS: ${error.message}`,
      });
      throw error;
    }

    // Upload file to IPFS via the relay server
    try {
      this.onStatusChange({
        code,
        status: WormholeStatus.UPLOADING,
        message: `Caricamento di ${filename} sul relay IPFS...`,
      });

      const formData = new FormData();
      const uploadFilename =
        encryptedFile?.name ||
        encryptionMetadata.encryptedFilename ||
        `${filename || encryptionMetadata.originalName}.enc`;
      formData.append('file', encryptedFile, uploadFilename);

      const response = await fetch(`${relayUrl}/api/v1/ipfs/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = 'Upload fallito';
        try {
          const errorResult = await response.json();
          errorMessage = errorResult.error || `Upload fallito (${response.status})`;
        } catch {
          errorMessage = `Upload fallito con status ${response.status}`;
        }
        this.onStatusChange({
          code,
          status: WormholeStatus.ERROR,
          message: errorMessage,
        });
        throw new Error(errorMessage);
      }

      const result = await response.json();
      if (!result.success || !result.file?.hash) {
        const errorMessage = result.error || 'Risposta non valida dal relay IPFS';
        this.onStatusChange({
          code,
          status: WormholeStatus.ERROR,
          message: errorMessage,
        });
        throw new Error(errorMessage);
      }

      const ipfsHash = result.file.hash;

      this.onStatusChange({
        code,
        status: WormholeStatus.PINNING,
        message: 'File aggiunto a IPFS. In attesa della conferma del pin...',
      });

      // Save metadata to Gun
      const transferData = {
        filename: filename,
        size: size,
        type: type,
        mode: 'ipfs',
        ipfsHash: ipfsHash,
        createdAt: Date.now(),
        encrypted: true,
        encryptedSize: encryptedFile.size,
        encryptionSerialized: serializedEncryption,
      };

      this.gun.get('shogun/wormhole').get('transfers').get(code).put({
        createdAt: transferData.createdAt,
      });

      this.gun.get(code).put(transferData);

      this.onStatusChange({
        code,
        status: WormholeStatus.SENT,
        message: 'File disponibile sul relay. Condividi il codice per iniziare il download.',
      });

      // Monitor for completion to unpin
      const completionHandler = async (data) => {
        if (data && data.status === 'completed') {
          this.gun.get(`${code}-received`).off(completionHandler);

          this.onStatusChange({
            code,
            status: WormholeStatus.COMPLETED,
            message: 'Trasferimento completato dal ricevente!',
          });

          try {
            this.onStatusChange({
              code,
              status: WormholeStatus.UNPINNING,
              message: 'Tentativo di unpin da IPFS per pulizia...',
            });

            const unpinResponse = await fetch(`${relayUrl}/api/v1/ipfs/pin/rm`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify({ cid: ipfsHash }),
            });

            if (unpinResponse.ok) {
              const unpinResult = await unpinResponse.json();
              if (unpinResult.success) {
                this.onStatusChange({
                  code,
                  status: WormholeStatus.UNPINNED,
                  message: 'File rimosso da IPFS con successo.',
                });
              } else {
                throw new Error(unpinResult.error || 'Unpin fallito sul relay.');
              }
            } else {
              throw new Error(`Il relay ha risposto con errore ${unpinResponse.status}`);
            }
          } catch (e) {
            console.error('Unpin failed:', e);
            this.onStatusChange({
              code,
              status: WormholeStatus.NOTICE,
              message:
                'Cleanup non riuscito, il file verrà rimosso dal GC del nodo IPFS.',
            });
          }
        }
      };
      this.gun.get(`${code}-received`).on(completionHandler);

      return code;
    } catch (error) {
      console.error('Errore di upload:', error);
      this.onStatusChange({
        code,
        status: WormholeStatus.ERROR,
        message: error.message,
      });
      throw error;
    }
  }

  receive(code, relayUrl) {
    this.onStatusChange({
      code,
      status: WormholeStatus.CONNECTING,
      message: `Ricerca del trasferimento: ${code}`,
    });

    const onceWithTimeout = (gunNode, timeout = 35000) => {
      return new Promise((resolve, reject) => {
        let dataReceived = false;

        const timer = setTimeout(() => {
          if (!dataReceived) {
            gunNode.off();
            reject(
              new Error(
                `Timeout: Nessun dato ricevuto per il codice "${code}" dopo ${timeout / 1000}s. Controlla il codice e riprova.`
              )
            );
          }
        }, timeout);

        const listener = (data, key) => {
          if (data && (data.mode === 'p2p' || data.ipfsHash) && !dataReceived) {
            if (!hasEncryptionMetadata(data)) {
              return;
            }
            dataReceived = true;
            clearTimeout(timer);
            gunNode.off(listener);
            resolve(data);
          }
        };

        gunNode.on(listener);
      });
    };

    onceWithTimeout(this.gun.get(code))
      .then(async (metadata) => {
        if (!metadata || (!metadata.ipfsHash && metadata.mode !== 'p2p')) {
          this.onStatusChange({
            code,
            status: WormholeStatus.ERROR,
            message: 'Codice non valido o trasferimento non trovato.',
          });
          return;
        }

        this.onStatusChange({
          code,
          status: WormholeStatus.FOUND,
          message: `Trasferimento trovato: ${metadata.filename} (${metadata.mode === 'p2p' ? 'P2P Direct' : 'IPFS Relay'})`,
          metadata,
        });

        const encryptionMetadata = buildEncryptionMetadata(metadata);
        if (metadata.encrypted && !encryptionMetadata) {
          this.onStatusChange({
            code,
            status: WormholeStatus.ERROR,
            message: 'Metadati di cifratura mancanti.',
          });
          return;
        }

        // --- P2P DIRECT STREAM RECEIVE ---
        if (metadata.mode === 'p2p') {
          this.onStatusChange({
            code,
            status: WormholeStatus.STREAMING_P2P,
            message: `Connessione WebRTC P2P al mittente per ${metadata.filename}...`,
          });

          // Signal sender that receiver is ready
          this.gun.get(`${code}-ready`).put({ ready: true, timestamp: Date.now() });

          const totalChunks = metadata.totalChunks || 1;
          const receivedChunks = new Map();
          let isFinalizing = false;

          const finalizeP2PDownload = async () => {
            if (isFinalizing) return;
            isFinalizing = true;

            this.onStatusChange({
              code,
              status: WormholeStatus.DECRYPTING,
              message: 'Decifratura dei chunk P2P ricevuti...',
            });

            try {
              const sortedChunks = [];
              for (let i = 0; i < totalChunks; i += 1) {
                const b64 = receivedChunks.get(i);
                if (!b64) throw new Error(`Chunk ${i} mancante nel trasferimento P2P.`);
                const bytes = base64ToUint8Array(b64);
                sortedChunks.push(bytes);
              }

              const totalBytes = sortedChunks.reduce((acc, c) => acc + c.length, 0);
              const combinedBuffer = new Uint8Array(totalBytes);
              let offset = 0;
              for (const chunkBytes of sortedChunks) {
                combinedBuffer.set(chunkBytes, offset);
                offset += chunkBytes.length;
              }

              const decryptedBuffer = await decryptArrayBufferWithCode(
                combinedBuffer.buffer,
                code,
                encryptionMetadata
              );

              const finalBlob = new Blob([decryptedBuffer], {
                type: metadata.type || 'application/octet-stream',
              });

              this.onStatusChange({
                code,
                status: WormholeStatus.DOWNLOADED,
                message: 'File P2P scaricato e decifrato con successo!',
                fileData: {
                  blob: finalBlob,
                  buffer: decryptedBuffer,
                  filename: metadata.filename,
                  type: metadata.type,
                },
              });

              // Notify sender of completion
              this.gun.get(`${code}-received`).put({
                status: 'completed',
                timestamp: Date.now(),
              });
            } catch (error) {
              console.error('Errore decifratura P2P:', error);
              this.onStatusChange({
                code,
                status: WormholeStatus.ERROR,
                message: error.message,
              });
            }
          };

          const chunkListener = (chunkData) => {
            if (chunkData && typeof chunkData.index === 'number' && chunkData.data) {
              if (!receivedChunks.has(chunkData.index)) {
                receivedChunks.set(chunkData.index, chunkData.data);

                const progress = Math.round((receivedChunks.size / totalChunks) * 100);
                this.onProgress({ progress, loaded: receivedChunks.size, total: totalChunks });

                if (receivedChunks.size === totalChunks) {
                  void finalizeP2PDownload();
                }
              }
            }
          };

          this.gun.get(`${code}-chunks`).map().on(chunkListener);

          this.gun.get(`${code}-complete`).on((data) => {
            if (data && data.complete && receivedChunks.size === totalChunks) {
              void finalizeP2PDownload();
            }
          });

          return;
        }

        // --- IPFS GATEWAY RECEIVE ---
        this.onStatusChange({
          code,
          status: WormholeStatus.DOWNLOADING,
          message: `Download di ${metadata.filename} da IPFS in corso...`,
        });

        try {
          const response = await fetch(`${relayUrl}/api/v1/ipfs/cat/${metadata.ipfsHash}`);
          if (!response.ok) {
            throw new Error(
              `Impossibile scaricare dal gateway IPFS (status: ${response.status})`
            );
          }

          const contentLength = response.headers.get('content-length');
          const total = parseInt(contentLength, 10);
          const expectedSize =
            total || (metadata.encrypted ? metadata.encryptedSize : metadata.size);

          let downloadBuffer = await readStreamToBuffer(
            response.body,
            expectedSize,
            (progressData) => this.onProgress(progressData)
          );

          let finalBlob;
          let decryptedBuffer;

          if (metadata.encrypted) {
            this.onStatusChange({
              code,
              status: WormholeStatus.DECRYPTING,
              message: 'Decifratura del file in corso...',
            });
            decryptedBuffer = await decryptArrayBufferWithCode(
              downloadBuffer,
              code,
              encryptionMetadata
            );
            finalBlob = new Blob([decryptedBuffer], {
              type: metadata.type || 'application/octet-stream',
            });
          } else {
            decryptedBuffer = downloadBuffer;
            finalBlob = new Blob([downloadBuffer], {
              type: metadata.type || 'application/octet-stream',
            });
          }

          this.onStatusChange({
            code,
            status: WormholeStatus.DOWNLOADED,
            message: 'File scaricato con successo.',
            fileData: {
              blob: finalBlob,
              buffer: decryptedBuffer,
              filename: metadata.filename,
              type: metadata.type,
            },
          });

          this.gun.get(`${code}-received`).put({
            status: 'completed',
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error('Errore di download IPFS:', error);
          this.onStatusChange({
            code,
            status: WormholeStatus.ERROR,
            message: error.message,
          });
        }
      })
      .catch((error) => {
        this.onStatusChange({
          code,
          status: WormholeStatus.ERROR,
          message: error.message,
        });
      });
  }
}

// Export utility functions for use in environment-specific code
export { generateCode, base64ToChunks };


