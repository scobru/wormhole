/**
 * Wormhole Freenet Adapter
 * Provides chunk-based decentralized file storage and rendezvous signaling on Freenet.
 */

import {
  ContractContainer,
  ContractKey,
  ContractType,
  DeltaUpdate,
  FreenetWsApi,
  GetRequest,
  PutRequest,
  UpdateData,
  UpdateDataType,
  UpdateRequest,
  WasmContractV1,
} from '@freenetorg/freenet-stdlib';
import { ContractCodeT } from '@freenetorg/freenet-stdlib/common';
import { RelatedContractsT } from '@freenetorg/freenet-stdlib/client-request';
import { blake3 } from '@noble/hashes/blake3.js';

const isNode =
  typeof process !== 'undefined' &&
  Boolean(process.versions?.node) &&
  typeof window === 'undefined';

export const CHUNK_SIZE = 256 * 1024; // 256 KB per chunk
const PUT_TIMEOUT_MS = 15000;
const GET_TIMEOUT_MS = 20000;

function getWsUrl() {
  const loc = typeof globalThis.location !== 'undefined' ? globalThis.location : null;
  if (!loc) return new URL('ws://127.0.0.1:7509/v1/contract/command');
  const isDefaultFreenet =
    loc.port === '7509' || (loc.pathname && loc.pathname.includes('/v1/contract/'));
  const host = isDefaultFreenet ? loc.host || '127.0.0.1:7509' : '127.0.0.1:7509';
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws';
  return new URL(`${proto}://${host}/v1/contract/command`);
}

let apiPromise = null;
export const updateListeners = new Set();

export function getFreenetApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const url = getWsUrl();
    const handler = {
      onContractPut() {},
      onContractGet() {},
      onContractUpdate() {},
      onContractUpdateNotification(n) {
        const keyEnc = n.key?.encode ? n.key.encode() : String(n.key);
        for (const fn of updateListeners) {
          try {
            fn(keyEnc);
          } catch (e) {
            console.warn('[Freenet] update listener error:', e);
          }
        }
      },
      onContractNotFound() {},
      onDelegateResponse() {},
      onErr(e) {
        console.error('[Freenet] WS Error:', e?.cause || e);
      },
      onOpen() {
        resolve(api);
      },
      onClose() {
        apiPromise = null;
        reject(new Error('Freenet WebSocket closed'));
      },
    };
    const api = new FreenetWsApi(url, handler, '');
  });
  return apiPromise;
}

export async function resetSocket() {
  try {
    const a = await getFreenetApi();
    if (a && a.ws && typeof a.ws.close === 'function') {
      a.ws.close();
    }
  } catch (_) {}
  apiPromise = null;
  await new Promise((r) => setTimeout(r, 200));
}

const withTimeout = (p, ms) =>
  Promise.race([
    p,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`Freenet request timed out (${ms}ms)`)), ms)
    ),
  ]);

export async function isFreenetAvailable(timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const url = getWsUrl();
      const ws = new WebSocket(url.toString());
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch (_) {}
        resolve(false);
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch (_) {}
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch (_) {}
        resolve(false);
      };
    } catch (_) {
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------- WASM Code Loaders
let chunkWasmCache = null;
export async function getChunkWasm() {
  if (chunkWasmCache) return chunkWasmCache;
  let code;
  if (isNode) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(currentDir, '../../../contracts/chunk.wasm'),
      path.resolve(currentDir, '../../contracts/chunk.wasm'),
      path.resolve(currentDir, '../contracts/chunk.wasm'),
      path.resolve(process.cwd(), 'contracts/chunk.wasm'),
      path.resolve(process.cwd(), 'web/public/chunk.wasm'),
    ];
    let found = null;
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        found = c;
        break;
      }
    }
    if (!found) throw new Error('chunk.wasm not found in contracts directory');
    code = new Uint8Array(fs.readFileSync(found));
  } else {
    let u = './chunk.wasm';
    if (typeof globalThis.location !== 'undefined' && globalThis.location.pathname) {
      const base = globalThis.location.pathname.replace(/[^/]*$/, '');
      const origin =
        globalThis.location.origin && globalThis.location.origin !== 'null'
          ? globalThis.location.origin
          : '';
      u = `${origin}${base}chunk.wasm`;
    }
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Cannot fetch chunk.wasm from ${u}: HTTP ${r.status}`);
    code = new Uint8Array(await r.arrayBuffer());
  }
  const codeHash = blake3(code);
  chunkWasmCache = { code, codeHash };
  return chunkWasmCache;
}

let channelWasmCache = null;
export async function getChannelWasm() {
  if (channelWasmCache) return channelWasmCache;
  let code;
  if (isNode) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(currentDir, '../../../contracts/wormhole_channel.wasm'),
      path.resolve(currentDir, '../../contracts/wormhole_channel.wasm'),
      path.resolve(currentDir, '../contracts/wormhole_channel.wasm'),
      path.resolve(process.cwd(), 'contracts/wormhole_channel.wasm'),
      path.resolve(process.cwd(), 'web/public/wormhole_channel.wasm'),
    ];
    let found = null;
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        found = c;
        break;
      }
    }
    if (!found) throw new Error('wormhole_channel.wasm not found in contracts directory');
    code = new Uint8Array(fs.readFileSync(found));
  } else {
    let u = './wormhole_channel.wasm';
    if (typeof globalThis.location !== 'undefined' && globalThis.location.pathname) {
      const base = globalThis.location.pathname.replace(/[^/]*$/, '');
      const origin =
        globalThis.location.origin && globalThis.location.origin !== 'null'
          ? globalThis.location.origin
          : '';
      u = `${origin}${base}wormhole_channel.wasm`;
    }
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Cannot fetch wormhole_channel.wasm from ${u}: HTTP ${r.status}`);
    code = new Uint8Array(await r.arrayBuffer());
  }
  const codeHash = blake3(code);
  channelWasmCache = { code, codeHash };
  return channelWasmCache;
}

// ---------------------------------------------------------------- Chunk Storage
const chunkKeys = new Map();
const knownChunks = new Set();

export async function putChunk(content) {
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  const { code, codeHash } = await getChunkWasm();
  const params = blake3(bytes);
  const instanceId = blake3(new Uint8Array([...codeHash, ...params]));
  const key = new ContractKey(instanceId, codeHash);
  const addr = key.encode();
  chunkKeys.set(addr, key);

  if (knownChunks.has(addr)) {
    return addr;
  }

  const contract = new WasmContractV1(
    new ContractCodeT(Array.from(code), Array.from(codeHash)),
    Array.from(params),
    key
  );

  const client = await getFreenetApi();
  try {
    await withTimeout(
      client.put(
        new PutRequest(
          new ContractContainer(ContractType.WasmContractV1, contract),
          Array.from(bytes),
          new RelatedContractsT()
        )
      ),
      PUT_TIMEOUT_MS
    );
  } catch (err) {
    if (/timeout/i.test(String(err))) {
      await resetSocket();
      try {
        await withTimeout(getChunk(addr), 5000);
      } catch (_) {
        throw new Error(`Freenet did not accept chunk ${addr}`);
      }
    } else if (!/already stored|duplicate/i.test(String(err))) {
      throw err;
    }
  }

  knownChunks.add(addr);
  return addr;
}

export async function getChunk(addr) {
  const client = await getFreenetApi();
  let key = chunkKeys.get(addr);
  if (!key) {
    key = ContractKey.fromInstanceId(addr);
  }

  const res = await withTimeout(
    client.get(new GetRequest(key, false)),
    GET_TIMEOUT_MS
  );

  if (res.key?.codePart && res.key.codePart()?.length === 32) {
    chunkKeys.set(addr, res.key);
  }
  return new Uint8Array(res.state);
}

// ---------------------------------------------------------------- Channel & Manifest
export function deriveChannelParams(code) {
  const text = new TextEncoder().encode(`wormhole-channel-v1:${code.trim().toLowerCase()}`);
  return blake3(text);
}

export async function getChannelKey(code) {
  const { codeHash } = await getChannelWasm();
  const params = deriveChannelParams(code);
  const instanceId = blake3(new Uint8Array([...codeHash, ...params]));
  return new ContractKey(instanceId, codeHash);
}

export async function publishChannel(code, stateData) {
  const client = await getFreenetApi();
  const { code: wasmCode, codeHash } = await getChannelWasm();
  const params = deriveChannelParams(code);
  const key = await getChannelKey(code);
  const jsonBytes = Array.from(new TextEncoder().encode(JSON.stringify(stateData)));

  // Try updating first; if not found, put it
  try {
    await withTimeout(
      client.update(
        new UpdateRequest(
          key,
          new UpdateData(UpdateDataType.DeltaUpdate, new DeltaUpdate(jsonBytes))
        )
      ),
      PUT_TIMEOUT_MS
    );
  } catch (e) {
    // Contract probably doesn't exist yet, PUT it
    const contract = new WasmContractV1(
      new ContractCodeT(Array.from(wasmCode), Array.from(codeHash)),
      Array.from(params),
      key
    );
    await withTimeout(
      client.put(
        new PutRequest(
          new ContractContainer(ContractType.WasmContractV1, contract),
          jsonBytes,
          new RelatedContractsT(),
          true
        )
      ),
      PUT_TIMEOUT_MS
    );
  }
}

export async function getChannel(code, subscribe = true) {
  const client = await getFreenetApi();
  const key = await getChannelKey(code);
  try {
    const res = await withTimeout(
      client.get(new GetRequest(key, false, subscribe)),
      GET_TIMEOUT_MS
    );
    if (!res.state || res.state.length === 0) return null;
    const str = new TextDecoder().decode(Uint8Array.from(res.state));
    return JSON.parse(str);
  } catch (e) {
    if (/not found/i.test(String(e))) {
      return null;
    }
    throw e;
  }
}

export async function onChannelUpdate(code, callback) {
  const key = await getChannelKey(code);
  const targetEncoded = key.encode();
  const listener = (keyStr) => {
    if (keyStr === targetEncoded) {
      getChannel(code, false)
        .then((state) => {
          if (state) callback(state);
        })
        .catch(() => {});
    }
  };
  updateListeners.add(listener);
  return () => updateListeners.delete(listener);
}

// ---------------------------------------------------------------- Crypto & High-Level Transfer
const cryptoSubtle = globalThis.crypto?.subtle || globalThis.window?.crypto?.subtle;

function getSubtleCrypto() {
  if (cryptoSubtle) return cryptoSubtle;
  throw new Error('WebCrypto subtle is not available in this environment');
}

export async function deriveKeyFromCode(code, salt) {
  const subtle = getSubtleCrypto();
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function makeChunkIv(baseIv, chunkIndex) {
  const iv = new Uint8Array(12);
  iv.set(baseIv.subarray(0, 8), 0);
  const view = new DataView(iv.buffer, 8, 4);
  view.setUint32(0, chunkIndex, false);
  return iv;
}

export function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromB64(str) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64'));
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Upload and encrypt a file to Freenet via chunk contracts and a channel manifest.
 */
export async function sendViaFreenet({
  file,
  filename,
  size,
  type,
  lastModified,
  code,
  onProgress = () => {},
  onStatusChange = () => {},
}) {
  const subtle = getSubtleCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const baseIv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveKeyFromCode(code, salt);

  const fileBytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
  const fileSize = size ?? fileBytes.byteLength;
  const numChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));

  onStatusChange({
    code,
    status: 'freenet-uploading-chunks',
    message: `Cifratura e upload su Freenet (0/${numChunks} chunk)...`,
  });

  const chunkAddrs = [];
  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileSize);
    const chunkPlain = fileBytes.subarray(start, end);
    const chunkIv = makeChunkIv(baseIv, i);

    const chunkEnc = new Uint8Array(
      await subtle.encrypt({ name: 'AES-GCM', iv: chunkIv }, aesKey, chunkPlain)
    );

    const addr = await putChunk(chunkEnc);
    chunkAddrs.push(addr);

    const percent = Math.round(((i + 1) / numChunks) * 100);
    onProgress({
      progress: percent,
      loaded: end,
      total: fileSize,
      chunkIndex: i + 1,
      totalChunks: numChunks,
    });
    onStatusChange({
      code,
      status: 'freenet-uploading-chunks',
      message: `Caricamento chunk Freenet: ${i + 1}/${numChunks} (${percent}%)`,
    });
  }

  onStatusChange({
    code,
    status: 'freenet-publishing-manifest',
    message: 'Pubblicazione manifest del trasferimento sul canale Freenet...',
  });

  const manifest = {
    v: 1,
    filename: filename || file.name || 'file.bin',
    size: fileSize,
    type: type || file.type || 'application/octet-stream',
    lastModified: lastModified || file.lastModified || Date.now(),
    chunkSize: CHUNK_SIZE,
    totalChunks: numChunks,
    chunks: chunkAddrs,
    salt: toB64(salt),
    iv: toB64(baseIv),
    createdAt: Date.now(),
  };

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestIv = crypto.getRandomValues(new Uint8Array(12));
  const manifestEnc = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv: manifestIv }, aesKey, manifestBytes)
  );

  const manifestEnvelope = {
    salt: toB64(salt),
    iv: toB64(manifestIv),
    data: toB64(manifestEnc),
  };

  await publishChannel(code, {
    manifest: JSON.stringify(manifestEnvelope),
    updated_at: Date.now(),
  });

  onStatusChange({
    code,
    status: 'sent',
    message: 'File pronto e distribuito sulla rete Freenet!',
  });

  return { code, manifest, chunkAddrs };
}

/**
 * Resolve, download, and decrypt a file from Freenet using the mnemonic code.
 */
export async function receiveViaFreenet(
  code,
  { onProgress = () => {}, onStatusChange = () => {} } = {}
) {
  const subtle = getSubtleCrypto();
  onStatusChange({
    code,
    status: 'freenet-resolving-manifest',
    message: 'Ricerca manifest del file sulla rete Freenet...',
  });

  let channelState = await getChannel(code);
  let attempts = 0;
  while (!channelState?.manifest && attempts < 15) {
    attempts++;
    await new Promise((r) => setTimeout(r, 1500));
    channelState = await getChannel(code);
  }

  if (!channelState?.manifest) {
    throw new Error(`Nessun file trovato su Freenet per il codice "${code}".`);
  }

  const envelope = JSON.parse(channelState.manifest);
  const manifestIv = fromB64(envelope.iv);
  const manifestCipher = fromB64(envelope.data);

  // We derive temporary key with PBKDF2; note: envelope or code might have salt or we derive with code
  // Let's resolve the salt:
  // In sendViaFreenet, we used a random salt, so the manifest envelope can carry salt in plaintext
  // Wait, if salt was inside the encrypted manifest, we need a known salt or salt in the envelope!
  // Let's check envelope salt:
  const salt = envelope.salt ? fromB64(envelope.salt) : deriveChannelParams(code).subarray(0, 16);
  const aesKey = await deriveKeyFromCode(code, salt);

  let manifest;
  try {
    const plainManifestBytes = await subtle.decrypt(
      { name: 'AES-GCM', iv: manifestIv },
      aesKey,
      manifestCipher
    );
    manifest = JSON.parse(new TextDecoder().decode(plainManifestBytes));
  } catch (e) {
    throw new Error('Impossibile decifrare il manifest: codice errato o corrotto.');
  }

  const { filename, size, type, chunks, iv: baseIvB64 } = manifest;
  const baseIv = fromB64(baseIvB64);
  const numChunks = chunks.length;

  onStatusChange({
    code,
    status: 'freenet-downloading-chunks',
    message: `Scaricamento e decifratura (0/${numChunks} chunk)...`,
    fileInfo: { filename, size, type },
  });

  const downloadedBytes = new Uint8Array(size);
  let offset = 0;

  for (let i = 0; i < numChunks; i++) {
    const addr = chunks[i];
    const chunkIv = makeChunkIv(baseIv, i);

    const chunkEnc = await getChunk(addr);
    const chunkPlain = new Uint8Array(
      await subtle.decrypt({ name: 'AES-GCM', iv: chunkIv }, aesKey, chunkEnc)
    );

    downloadedBytes.set(chunkPlain, offset);
    offset += chunkPlain.byteLength;

    const percent = Math.round(((i + 1) / numChunks) * 100);
    onProgress({
      progress: percent,
      loaded: offset,
      total: size,
      chunkIndex: i + 1,
      totalChunks: numChunks,
    });
    onStatusChange({
      code,
      status: 'freenet-downloading-chunks',
      message: `Scaricamento da Freenet: ${i + 1}/${numChunks} (${percent}%)`,
    });
  }

  onStatusChange({
    code,
    status: 'completed',
    message: 'File scaricato e decifrato con successo da Freenet!',
  });

  return {
    filename,
    size,
    type,
    data: downloadedBytes,
    file:
      typeof File !== 'undefined'
        ? new File([downloadedBytes], filename, { type })
        : null,
  };
}
