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

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

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

  async send({ file, filename, size, type, relayUrl, authToken, lastModified }) {
    const code = generateCode();

    this.onStatusChange({
      code,
      status: WormholeStatus.CHECKING_RELAY,
      message: 'Verifica connessione al relay IPFS...',
    });

    // Verifica connessione al relay
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

    // 1. Upload file to IPFS via the relay server
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

      // 2. Save metadata (including the IPFS hash) to Gun
      const serializedEncryption = JSON.stringify(encryptionMetadata);

      const transferData = {
        filename: filename,
        size: size,
        type: type,
        ipfsHash: ipfsHash,
        createdAt: Date.now(), // For the Garbage Collector
        encrypted: true,
        encryptedSize: encryptedFile.size,
        // Optimization: Reduce metadata size and GunDB graph complexity
        // by sending only the serialized metadata string.
        // We avoid sending the redundant 'encryption' object (which creates a sub-node)
        // and the flat fields. The receiver's buildEncryptionMetadata handles this correctly.
        encryptionSerialized: serializedEncryption,
      };
      // Also add to a central index for the GC to find it
      this.gun.get('shogun/wormhole').get('transfers').get(code).put({
        createdAt: transferData.createdAt,
      });

      // Store metadata under the generated code
      this.gun.get(code).put(transferData, (ack) => {
        console.log('✅ Dati salvati su Gun per codice:', code, 'Ack:', ack);
      });

      // Verifica immediata che i dati siano stati salvati
      this.gun.get(code).once((savedData) => {
        console.log('🔍 Verifica dati salvati:', savedData);
      });

      this.onStatusChange({
        code,
        status: WormholeStatus.SENT,
        message: 'File disponibile. Condividi il codice per iniziare il download.',
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
    console.log('🔍 Inizio receive per codice:', code);

    this.onStatusChange({
      code,
      status: WormholeStatus.CONNECTING,
      message: `Ricerca del trasferimento: ${code}`,
    });

    const onceWithTimeout = (gunNode, timeout = 30000) => {
      return new Promise((resolve, reject) => {
        console.log('⏱️ Attendo dati da Gun per:', code);
        let dataReceived = false;

        const timer = setTimeout(() => {
          if (!dataReceived) {
            console.log('❌ TIMEOUT: Nessun dato ricevuto per:', code);
            gunNode.off(); // Clean up the listener
            reject(
              new Error(
                `Timeout: Nessun dato ricevuto per il codice "${code}" dopo ${timeout / 1000}s. Controlla il codice e riprova.`
              )
            );
          }
        }, timeout);

        // Usa .on() invece di .once() per continuare ad ascoltare
        const listener = (data, key) => {
          console.log('📦 Dati ricevuti da Gun:', data, 'Key:', key);
          if (data && data.ipfsHash && !dataReceived) {
            if (!hasEncryptionMetadata(data)) {
              console.log('⏳ Metadati cifratura incompleti, attendo aggiornamenti...');
              return;
            }
            dataReceived = true;
            clearTimeout(timer);
            gunNode.off(listener); // Rimuovi il listener
            resolve(data);
          }
        };

        gunNode.on(listener);
      });
    };

    console.log('🔍 Cerco dati su Gun node:', this.gun.get(code));
    onceWithTimeout(this.gun.get(code))
      .then(async (metadata) => {
        if (!metadata || !metadata.ipfsHash) {
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
          message: `Trasferimento trovato: ${metadata.filename}`,
          metadata,
        });

        this.onStatusChange({
          code,
          status: WormholeStatus.DOWNLOADING,
          message: `Download di ${metadata.filename} da IPFS in corso...`,
        });

        // 3. Download file from IPFS Gateway
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

          let downloadBuffer;
          try {
            downloadBuffer = await readStreamToBuffer(
              response.body,
              expectedSize,
              (progressData) => this.onProgress(progressData)
            );
          } catch (streamError) {
            console.error('Errore stream:', streamError);
            throw streamError;
          }

          let finalBlob;
          let decryptedBuffer;
          const encryptionMetadata = buildEncryptionMetadata(metadata);

          if (metadata.encrypted) {
            if (!encryptionMetadata) {
              this.onStatusChange({
                code,
                status: WormholeStatus.ERROR,
                message:
                  'Metadati di cifratura mancanti. Attendi qualche secondo e riprova oppure richiedi al mittente di ritrasferire il file.',
              });
              return;
            }

            try {
              // OPTIMIZATION: Read directly into ArrayBuffer to avoid creating intermediate Blob
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
            } catch (error) {
              console.error('Errore di decifratura:', error);
              this.onStatusChange({
                code,
                status: WormholeStatus.ERROR,
                message: error.message,
              });
              return;
            }
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
              // Optimization: Pass buffer directly to avoid Blob -> ArrayBuffer conversion
              buffer: decryptedBuffer,
              filename: metadata.filename,
              type: metadata.type,
            },
          });

          // Notify sender
          this.gun.get(`${code}-received`).put({
            status: 'completed',
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error('Errore di download:', error);
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


