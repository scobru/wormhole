// Removed shogun-relays dependency logic

// Shared config
import {
  sendViaFreenet,
  receiveViaFreenet,
  isFreenetAvailable,
  getChannel,
} from './freenet.js';

const CHUNK_SIZE = 65536; // 64KB chunks
const ENCRYPTION_CONFIG = {
  saltLength: 16,
  ivLength: 12,
  iterations: 150000,
  hash: 'SHA-256',
  algorithm: 'AES-GCM',
  keyLength: 256,
};

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

function serializeCandidate(candidate) {
  if (!candidate) return null;
  return JSON.stringify(candidate.toJSON ? candidate.toJSON() : candidate);
}

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
  FREENET_UPLOADING_CHUNKS: 'freenet-uploading-chunks',
  FREENET_PUBLISHING_MANIFEST: 'freenet-publishing-manifest',
  FREENET_RESOLVING_MANIFEST: 'freenet-resolving-manifest',
  FREENET_DOWNLOADING_CHUNKS: 'freenet-downloading-chunks',
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
    throw new Error('Missing or invalid encryption metadata.');
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
    throw new Error('Corrupted encryption metadata (invalid base64).');
  }
}

function normalizeToUint8Array(value, label) {
  if (!value && value !== 0) {
    throw new Error(`Incomplete encryption metadata: ${label} missing.`);
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

  throw new Error(`Unsupported encryption metadata format for ${label}.`);
}

function parseSerializedMetadata(serialized) {
  if (typeof serialized !== 'string' || serialized.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(serialized);
  } catch (error) {
    console.warn('Unable to parse serialized encryption metadata:', error);
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
    throw new Error('Failed to decrypt file. Please verify the sync code and try again.');
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
    this.gun = options.gun || null;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onProgress = options.onProgress || (() => {});
  }

  async send({ file, filename, size, type, relayUrl, authToken, lastModified, mode = 'p2p' }) {
    if (mode === 'freenet') {
      const code = generateCode();
      const res = await sendViaFreenet({
        file,
        filename,
        size,
        type,
        lastModified,
        code,
        onProgress: this.onProgress,
        onStatusChange: this.onStatusChange,
      });
      return code;
    }

    if (!this.gun) {
      throw new Error('A gun instance must be provided via the "gun" option when not using Freenet mode.');
    }

    const code = generateCode();

    let encryptedFile;
    let encryptionMetadata;

    try {
      this.onStatusChange({
        code,
        status: WormholeStatus.ENCRYPTING,
        message: 'Encrypting file...',
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
      console.error('Encryption error:', error);
      this.onStatusChange({
        code,
        status: WormholeStatus.ERROR,
        message: `Encryption failed: ${error.message}`,
      });
      throw error;
    }

    const serializedEncryption = JSON.stringify(encryptionMetadata);

    if (mode === 'p2p') {
      const PeerConnectionClass = globalThis.RTCPeerConnection;
      if (!PeerConnectionClass) {
        throw new Error('WebRTC (RTCPeerConnection) is not supported in this environment.');
      }

      const arrayBuffer = await encryptedFile.arrayBuffer();
      const CHUNK_SIZE = 64 * 1024; // 64KB per chunk
      const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);

      const pc = new PeerConnectionClass(RTC_CONFIG);
      const dataChannel = pc.createDataChannel('wormhole-p2p', { ordered: true });
      dataChannel.binaryType = 'arraybuffer';

      const pendingCandidates = [];
      const addCandidateSafely = (cand) => {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          pc.addIceCandidate(new (globalThis.RTCIceCandidate || RTCIceCandidate)(cand)).catch(() => {});
        } else {
          pendingCandidates.push(cand);
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const serialized = serializeCandidate(event.candidate);
          if (serialized) {
            this.gun.get(`${code}-ice-sender`).set(serialized);
          }
        }
      };

      this.gun.get(`${code}-ice-receiver`).map().on((candidateStr) => {
        if (candidateStr) {
          try {
            const cand = JSON.parse(candidateStr);
            addCandidateSafely(cand);
          } catch (e) {}
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait a moment for initial ICE gathering so host/srflx candidates are in the offer SDP
      await new Promise((r) => {
        if (pc.iceGatheringState === 'complete') {
          r();
        } else {
          const timeout = setTimeout(r, 400);
          pc.onicegatheringstatechange = () => {
            if (pc.iceGatheringState === 'complete') {
              clearTimeout(timeout);
              r();
            }
          };
        }
      });

      const transferData = {
        filename,
        size,
        type,
        mode: 'p2p',
        totalChunks,
        chunkSize: CHUNK_SIZE,
        createdAt: Date.now(),
        encrypted: true,
        encryptedSize: encryptedFile.size,
        encryptionSerialized: serializedEncryption,
        offer: JSON.stringify(pc.localDescription),
      };

      this.gun.get('shogun/wormhole').get('transfers').get(code).put({
        createdAt: transferData.createdAt,
      });
      this.gun.get(code).put(transferData);

      this.onStatusChange({
        code,
        status: WormholeStatus.WAITING_PEER,
        message: 'Encrypted file ready! Waiting for recipient to enter sync code...',
      });

      let answerApplied = false;
      this.gun.get(`${code}-answer`).on(async (answerData) => {
        if (answerData && answerData.answer && !answerApplied) {
          answerApplied = true;
          try {
            const answer = JSON.parse(answerData.answer);
            await pc.setRemoteDescription(new (globalThis.RTCSessionDescription || RTCSessionDescription)(answer));
            for (const cand of pendingCandidates) {
              pc.addIceCandidate(new (globalThis.RTCIceCandidate || RTCIceCandidate)(cand)).catch(() => {});
            }
            pendingCandidates.length = 0;
          } catch (e) {
            console.error('Error applying SDP Answer:', e);
          }
        }
      });

      let transferStarted = false;
      const startStreaming = async () => {
        if (transferStarted) return;
        transferStarted = true;

        this.onStatusChange({
          code,
          status: WormholeStatus.STREAMING_P2P,
          message: `WebRTC P2P stream active! Sending ${filename} (${totalChunks} 64KB chunks)...`,
        });

        // 1. Send Header
        dataChannel.send(
          JSON.stringify({
            type: 'wormhole-header',
            filename,
            size,
            encryptedSize: encryptedFile.size,
            totalChunks,
            chunkSize: CHUNK_SIZE,
          })
        );

        // 2. Stream Binary Chunks with Flow Control (Backpressure)
        dataChannel.bufferedAmountLowThreshold = 1024 * 1024; // 1MB
        for (let i = 0; i < totalChunks; i += 1) {
          if (dataChannel.readyState !== 'open') {
            throw new Error('WebRTC channel closed during transfer.');
          }

          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
          const slice = arrayBuffer.slice(start, end);

          dataChannel.send(slice);

          const loaded = end;
          this.onProgress({
            progress: Math.round((loaded / arrayBuffer.byteLength) * 100),
            loaded,
            total: arrayBuffer.byteLength,
          });

          // Wait if buffer exceeds 2MB
          if (dataChannel.bufferedAmount > 2 * 1024 * 1024) {
            await new Promise((resolve) => {
              const onLow = () => {
                dataChannel.onbufferedamountlow = null;
                resolve();
              };
              dataChannel.onbufferedamountlow = onLow;
              setTimeout(resolve, 250);
            });
          }
        }

        // 3. Send EOF
        dataChannel.send(JSON.stringify({ type: 'wormhole-eof' }));
      };

      if (dataChannel.readyState === 'open') {
        void startStreaming();
      } else {
        dataChannel.onopen = () => {
          void startStreaming();
        };
      }

      dataChannel.onmessage = (msgEvent) => {
        if (typeof msgEvent.data === 'string') {
          try {
            const msg = JSON.parse(msgEvent.data);
            if (msg.type === 'wormhole-ack') {
              this.onStatusChange({
                code,
                status: WormholeStatus.COMPLETED,
                message: 'WebRTC P2P transfer completed successfully!',
              });
              setTimeout(() => {
                try {
                  dataChannel.close();
                  pc.close();
                } catch (e) {}
              }, 1000);
            }
          } catch (e) {}
        }
      };

      const completionHandler = async (data) => {
        if (data && data.status === 'completed') {
          this.gun.get(`${code}-received`).off(completionHandler);
          this.onStatusChange({
            code,
            status: WormholeStatus.COMPLETED,
            message: 'WebRTC P2P transfer completed by recipient!',
          });
          setTimeout(() => {
            try {
              dataChannel.close();
              pc.close();
            } catch (e) {}
          }, 1000);
        }
      };
      this.gun.get(`${code}-received`).on(completionHandler);

      return code;
    }

    // Default: IPFS Relay mode
    const targetRelay =
      relayUrl && relayUrl !== 'undefined'
        ? relayUrl
        : 'https://delay.scobrudot.dev';
    const targetToken =
      authToken && authToken !== 'undefined'
        ? authToken
        : 'shogun2025';

    this.onStatusChange({
      code,
      status: WormholeStatus.CHECKING_RELAY,
      message: 'Checking IPFS relay connection...',
    });

    try {
      const healthCheck = await fetch(`${targetRelay}/health`);
      if (!healthCheck.ok) {
        throw new Error('IPFS relay unreachable');
      }
    } catch (error) {
      this.onStatusChange({
        code,
        status: WormholeStatus.ERROR,
        message: `IPFS relay connection error: ${error.message}`,
      });
      throw error;
    }

    // Upload file to IPFS via the relay server
    try {
      this.onStatusChange({
        code,
        status: WormholeStatus.UPLOADING,
        message: `Uploading ${filename} to IPFS relay...`,
      });

      const formData = new FormData();
      const uploadFilename =
        encryptedFile?.name ||
        encryptionMetadata.encryptedFilename ||
        `${filename || encryptionMetadata.originalName}.enc`;
      formData.append('file', encryptedFile, uploadFilename);

      const response = await fetch(`${targetRelay}/api/v1/ipfs/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${targetToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = 'Upload failed';
        try {
          const errorResult = await response.json();
          errorMessage = errorResult.error || `Upload failed (${response.status})`;
        } catch {
          errorMessage = `Upload failed with status ${response.status}`;
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
        const errorMessage = result.error || 'Invalid response from IPFS relay';
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
        message: 'File pinned to IPFS. Awaiting pin confirmation...',
      });

      // Save metadata to Gun
      const transferData = {
        filename: filename,
        size: size,
        type: type,
        mode: 'ipfs',
        ipfsHash: ipfsHash,
        relayUrl: targetRelay,
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
        message: 'File ready on relay. Share sync code to begin download.',
      });

      // Monitor for completion to unpin
      const completionHandler = async (data) => {
        if (data && data.status === 'completed') {
          this.gun.get(`${code}-received`).off(completionHandler);

          this.onStatusChange({
            code,
            status: WormholeStatus.COMPLETED,
            message: 'Transfer completed by recipient!',
          });

          try {
            this.onStatusChange({
              code,
              status: WormholeStatus.UNPINNING,
              message: 'Unpinning file from IPFS relay for cleanup...',
            });

            const unpinResponse = await fetch(`${targetRelay}/api/v1/ipfs/pin/rm`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${targetToken}`,
              },
              body: JSON.stringify({ cid: ipfsHash }),
            });

            if (unpinResponse.ok) {
              const unpinResult = await unpinResponse.json();
              if (unpinResult.success) {
                this.onStatusChange({
                  code,
                  status: WormholeStatus.UNPINNED,
                  message: 'File unpinned from IPFS successfully.',
                });
              } else {
                throw new Error(unpinResult.error || 'Unpin failed on relay.');
              }
            } else {
              throw new Error(`Relay responded with error ${unpinResponse.status}`);
            }
          } catch (e) {
            console.error('Unpin failed:', e);
            this.onStatusChange({
              code,
              status: WormholeStatus.NOTICE,
              message:
                'Cleanup failed; file will be removed by IPFS garbage collection.',
            });
          }
        }
      };
      this.gun.get(`${code}-received`).on(completionHandler);

      return code;
    } catch (error) {
      console.error('Upload error:', error);
      this.onStatusChange({
        code,
        status: WormholeStatus.ERROR,
        message: error.message,
      });
      throw error;
    }
  }

  async receive(code, relayUrl, mode = 'auto') {
    if (mode === 'freenet') {
      try {
        const fileData = await receiveViaFreenet(code, {
          onProgress: this.onProgress,
          onStatusChange: this.onStatusChange,
        });
        const blob = fileData.file || new Blob([fileData.data], { type: fileData.type });
        this.onStatusChange({
          code,
          status: WormholeStatus.COMPLETED,
          message: 'File successfully received from Freenet!',
          fileData: {
            blob,
            filename: fileData.filename,
            buffer: fileData.data,
            metadata: {
              filename: fileData.filename,
              size: fileData.size,
              type: fileData.type,
            },
          },
        });
        return fileData;
      } catch (err) {
        this.onStatusChange({
          code,
          status: WormholeStatus.ERROR,
          message: err.message,
        });
        throw err;
      }
    }

    if (!this.gun) {
      return this.receive(code, relayUrl, 'freenet');
    }

    if (mode === 'auto') {
      try {
        const fnAvailable = await isFreenetAvailable(800);
        if (fnAvailable) {
          const fnState = await getChannel(code, false).catch(() => null);
          if (fnState && fnState.manifest) {
            return this.receive(code, relayUrl, 'freenet');
          }
        }
      } catch (_) {}
    }

    this.onStatusChange({
      code,
      status: WormholeStatus.CONNECTING,
      message: `Locating transfer: ${code}`,
    });

    const onceWithTimeout = (gunNode, timeout = 35000) => {
      return new Promise((resolve, reject) => {
        let dataReceived = false;
        let pollInterval = null;

        const timer = setTimeout(() => {
          if (!dataReceived) {
            if (pollInterval) clearInterval(pollInterval);
            gunNode.off();
            reject(
              new Error(
                `Timeout: No transfer data found for sync code "${code}" after ${timeout / 1000}s. Please check code and try again.`
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
            if (pollInterval) clearInterval(pollInterval);
            gunNode.off(listener);
            resolve(data);
          }
        };

        gunNode.on(listener);

        // Periodically trigger query in case WebSocket connected after listener registration
        pollInterval = setInterval(() => {
          if (dataReceived) {
            if (pollInterval) clearInterval(pollInterval);
            return;
          }
          gunNode.once(listener);
          this.gun.get(code).once(listener);
        }, 1000);
      });
    };

    onceWithTimeout(this.gun.get(code))
      .then(async (metadata) => {
        if (!metadata || (!metadata.ipfsHash && metadata.mode !== 'p2p')) {
          this.onStatusChange({
            code,
            status: WormholeStatus.ERROR,
            message: 'Invalid code or transfer not found.',
          });
          return;
        }

        this.onStatusChange({
          code,
          status: WormholeStatus.FOUND,
          message: `Transfer found: ${metadata.filename} (${metadata.mode === 'p2p' ? 'P2P Direct' : 'IPFS Relay'})`,
          metadata,
        });

        const encryptionMetadata = buildEncryptionMetadata(metadata);
        if (metadata.encrypted && !encryptionMetadata) {
          this.onStatusChange({
            code,
            status: WormholeStatus.ERROR,
            message: 'Missing encryption metadata.',
          });
          return;
        }

        // --- P2P DIRECT WEBRTC STREAM RECEIVE ---
        if (metadata.mode === 'p2p') {
          const PeerConnectionClass = globalThis.RTCPeerConnection;
          if (!PeerConnectionClass) {
            throw new Error('WebRTC (RTCPeerConnection) is not supported in this environment.');
          }

          if (!metadata.offer) {
            throw new Error('Missing WebRTC offer in transfer metadata.');
          }

          this.onStatusChange({
            code,
            status: WormholeStatus.CONNECTING,
            message: `Negotiating WebRTC P2P connection for ${metadata.filename}...`,
          });

          const pc = new PeerConnectionClass(RTC_CONFIG);
          const pendingCandidates = [];
          const addCandidateSafely = (cand) => {
            if (pc.remoteDescription && pc.remoteDescription.type) {
              pc.addIceCandidate(new (globalThis.RTCIceCandidate || RTCIceCandidate)(cand)).catch(() => {});
            } else {
              pendingCandidates.push(cand);
            }
          };

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              const serialized = serializeCandidate(event.candidate);
              if (serialized) {
                this.gun.get(`${code}-ice-receiver`).set(serialized);
              }
            }
          };

          this.gun.get(`${code}-ice-sender`).map().on((candidateStr) => {
            if (candidateStr) {
              try {
                const cand = JSON.parse(candidateStr);
                addCandidateSafely(cand);
              } catch (e) {}
            }
          });

          let fileHeader = null;
          const receivedChunks = [];
          let totalReceivedBytes = 0;
          let isFinalizing = false;

          const finalizeDownload = async (activeDc) => {
            if (isFinalizing) return;
            isFinalizing = true;

            this.onStatusChange({
              code,
              status: WormholeStatus.DECRYPTING,
              message: 'All WebRTC chunks received. Decrypting file...',
            });

            try {
              const combinedBuffer = new Uint8Array(totalReceivedBytes);
              let offset = 0;
              for (const chunk of receivedChunks) {
                combinedBuffer.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
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
                message: 'File downloaded & decrypted successfully via WebRTC!',
                fileData: {
                  blob: finalBlob,
                  buffer: decryptedBuffer,
                  filename: metadata.filename,
                  type: metadata.type,
                },
              });

              if (activeDc && activeDc.readyState === 'open') {
                try {
                  activeDc.send(JSON.stringify({ type: 'wormhole-ack' }));
                } catch (e) {}
              }

              this.gun.get(`${code}-received`).put({
                status: 'completed',
                timestamp: Date.now(),
              });

              setTimeout(() => {
                try {
                  activeDc?.close();
                  pc.close();
                } catch (e) {}
              }, 1000);
            } catch (error) {
              console.error('P2P decryption error:', error);
              this.onStatusChange({
                code,
                status: WormholeStatus.ERROR,
                message: error.message,
              });
            }
          };

          pc.ondatachannel = (event) => {
            const dc = event.channel;
            dc.binaryType = 'arraybuffer';

            dc.onopen = () => {
              this.onStatusChange({
                code,
                status: WormholeStatus.STREAMING_P2P,
                message: `WebRTC P2P stream active! Receiving ${metadata.filename}...`,
              });
            };

            dc.onmessage = async (msgEvent) => {
              if (typeof msgEvent.data === 'string') {
                try {
                  const msg = JSON.parse(msgEvent.data);
                  if (msg.type === 'wormhole-header') {
                    fileHeader = msg;
                  } else if (msg.type === 'wormhole-eof') {
                    await finalizeDownload(dc);
                  }
                } catch (e) {
                  console.error('Error handling control message:', e);
                }
              } else if (msgEvent.data instanceof ArrayBuffer) {
                receivedChunks.push(msgEvent.data);
                totalReceivedBytes += msgEvent.data.byteLength;

                const expectedTotal =
                  metadata.encryptedSize ||
                  fileHeader?.encryptedSize ||
                  metadata.size ||
                  totalReceivedBytes;

                const progress = Math.min(100, Math.round((totalReceivedBytes / expectedTotal) * 100));
                this.onProgress({
                  progress,
                  loaded: totalReceivedBytes,
                  total: expectedTotal,
                });
              }
            };

            dc.onerror = (err) => {
              console.error('WebRTC DataChannel error:', err);
            };
          };

          const offer = JSON.parse(metadata.offer);
          await pc.setRemoteDescription(new (globalThis.RTCSessionDescription || RTCSessionDescription)(offer));

          for (const cand of pendingCandidates) {
            pc.addIceCandidate(new (globalThis.RTCIceCandidate || RTCIceCandidate)(cand)).catch(() => {});
          }
          pendingCandidates.length = 0;

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          await new Promise((r) => {
            if (pc.iceGatheringState === 'complete') {
              r();
            } else {
              const timeout = setTimeout(r, 300);
              pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === 'complete') {
                  clearTimeout(timeout);
                  r();
                }
              };
            }
          });

          this.gun.get(`${code}-answer`).put({
            answer: JSON.stringify(pc.localDescription),
            timestamp: Date.now(),
          });

          return;
        }

        // --- IPFS GATEWAY RECEIVE ---
        this.onStatusChange({
          code,
          status: WormholeStatus.DOWNLOADING,
          message: `Downloading ${metadata.filename} from IPFS...`,
        });

        try {
          const effectiveRelayUrl =
            metadata.relayUrl && metadata.relayUrl !== 'undefined'
              ? metadata.relayUrl
              : relayUrl && relayUrl !== 'undefined'
                ? relayUrl
                : 'https://delay.scobrudot.dev';
          const response = await fetch(`${effectiveRelayUrl}/api/v1/ipfs/cat/${metadata.ipfsHash}`);
          if (!response.ok) {
            throw new Error(
              `Unable to download from IPFS gateway (status: ${response.status})`
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
              message: 'Decrypting file...',
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
            message: 'File downloaded successfully.',
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
          console.error('IPFS download error:', error);
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
export {
  generateCode,
  base64ToChunks,
  sendViaFreenet,
  receiveViaFreenet,
  isFreenetAvailable,
};


