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
import { encodeFEC, decodeFEC, regenerateShard } from 'freenet-blob';

export { encodeFEC, decodeFEC, regenerateShard };

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

  // Apply Forward Error Correction (Reed-Solomon Erasure Coding)
  const fecResult = encodeFEC(fileBytes, { shardSize: CHUNK_SIZE });
  const totalShards = fecResult.totalShards;
  const numDataShards = fecResult.k;
  const numParityShards = fecResult.m;

  onStatusChange({
    code,
    status: 'freenet-uploading-chunks',
    message: `Encrypting & uploading to Freenet (${totalShards} shards: ${numDataShards} data + ${numParityShards} parity)...`,
  });

  const chunkAddrs = [];
  for (let i = 0; i < totalShards; i++) {
    const shard = fecResult.shards[i];
    const chunkPlain = shard.data;
    const chunkIv = makeChunkIv(baseIv, i);

    const chunkEnc = new Uint8Array(
      await subtle.encrypt({ name: 'AES-GCM', iv: chunkIv }, aesKey, chunkPlain)
    );

    const addr = await putChunk(chunkEnc);
    chunkAddrs.push(addr);

    const percent = Math.round(((i + 1) / totalShards) * 100);
    const label = shard.isParity
      ? `Parity ${i - numDataShards + 1}/${numParityShards}`
      : `Data ${i + 1}/${numDataShards}`;

    onProgress({
      progress: percent,
      loaded: Math.min((i + 1) * fecResult.shardSize, fileSize),
      total: fileSize,
      chunkIndex: i + 1,
      totalChunks: totalShards,
    });
    onStatusChange({
      code,
      status: 'freenet-uploading-chunks',
      message: `Uploading Freenet shard ${i + 1}/${totalShards} [${label}] (${percent}%)`,
    });
  }

  onStatusChange({
    code,
    status: 'freenet-publishing-manifest',
    message: 'Publishing resilient transfer manifest to Freenet channel...',
  });

  const manifest = {
    v: 2,
    filename: filename || file.name || 'file.bin',
    size: fileSize,
    type: type || file.type || 'application/octet-stream',
    lastModified: lastModified || file.lastModified || Date.now(),
    chunkSize: fecResult.shardSize,
    totalChunks: totalShards,
    fec: {
      enabled: true,
      k: numDataShards,
      m: numParityShards,
      total: totalShards,
      originalSize: fileSize,
      shardSize: fecResult.shardSize,
    },
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
    message: 'File encrypted & published to Freenet network with FEC redundancy!',
  });

  return { code, manifest, chunkAddrs };
}

/**
 * Resolve, download, and decrypt a file from Freenet using the mnemonic code.
 * Seamlessly handles resilient Reed-Solomon FEC reconstruction.
 */
export async function receiveViaFreenet(
  code,
  { onProgress = () => {}, onStatusChange = () => {} } = {}
) {
  const subtle = getSubtleCrypto();
  onStatusChange({
    code,
    status: 'freenet-resolving-manifest',
    message: 'Resolving file manifest on Freenet...',
  });

  let channelState = await getChannel(code);
  let attempts = 0;
  while (!channelState?.manifest && attempts < 15) {
    attempts++;
    await new Promise((r) => setTimeout(r, 1500));
    channelState = await getChannel(code);
  }

  if (!channelState?.manifest) {
    throw new Error(`No file found on Freenet for sync code "${code}".`);
  }

  const envelope = JSON.parse(channelState.manifest);
  const manifestIv = fromB64(envelope.iv);
  const manifestCipher = fromB64(envelope.data);

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
    throw new Error('Unable to decrypt manifest: invalid or corrupted sync code.');
  }

  const { filename, size, type, chunks, iv: baseIvB64, fec } = manifest;
  const baseIv = fromB64(baseIvB64);
  const totalChunks = chunks.length;
  const isFec = Boolean(fec && fec.enabled);
  const totalShards = isFec ? (fec?.total || totalChunks) : totalChunks;
  const targetK = isFec ? fec.k : totalChunks;

  onStatusChange({
    code,
    status: 'freenet-downloading-chunks',
    message: isFec
      ? `Downloading from Freenet (need any ${targetK} of ${totalChunks} resilient shards)...`
      : `Downloading & decrypting (0/${totalChunks} chunks)...`,
    fileInfo: { filename, size, type },
  });

  const receivedShards = [];
  const failedShards = [];

  for (let i = 0; i < totalChunks; i++) {
    const addr = chunks[i];
    const chunkIv = makeChunkIv(baseIv, i);
    const isParityShard = isFec && i >= targetK;
    const shardLabel = isFec
      ? (isParityShard ? `Parity shard #${i - targetK + 1}/${fec.m}` : `Data shard #${i + 1}/${targetK}`)
      : `Chunk #${i + 1}/${totalChunks}`;

    onStatusChange({
      code,
      status: 'freenet-downloading-chunks',
      message: isFec
        ? `Fetching ${shardLabel} (${receivedShards.length}/${targetK} required)${failedShards.length > 0 ? ` · ⚠️ ${failedShards.length} missed` : ''}...`
        : `Fetching chunk ${i + 1}/${totalChunks}...`,
      stats: {
        retrieved: receivedShards.length,
        required: targetK,
        total: totalChunks,
        failed: failedShards.length,
        currentShard: i + 1,
        isParity: isParityShard,
      },
    });

    try {
      const chunkEnc = await getChunk(addr);
      const chunkPlain = new Uint8Array(
        await subtle.decrypt({ name: 'AES-GCM', iv: chunkIv }, aesKey, chunkEnc)
      );

      receivedShards.push({ index: i, data: chunkPlain, isParity: isParityShard });

      const percent = Math.min(100, Math.round((receivedShards.length / targetK) * 100));
      onProgress({
        progress: percent,
        loaded: Math.min(receivedShards.length * (fec?.shardSize || CHUNK_SIZE), size),
        total: size,
        chunkIndex: receivedShards.length,
        totalChunks: targetK,
        failedCount: failedShards.length,
      });
      onStatusChange({
        code,
        status: 'freenet-downloading-chunks',
        message: isFec
          ? `Retrieved ${shardLabel} [${receivedShards.length}/${targetK} required, ${percent}%]${failedShards.length > 0 ? ` · ⚠️ ${failedShards.length} missed` : ''}`
          : `Downloading from Freenet: ${receivedShards.length}/${totalChunks} (${percent}%)`,
        stats: {
          retrieved: receivedShards.length,
          required: targetK,
          total: totalChunks,
          failed: failedShards.length,
        },
      });

      // Once we have reached K shards under FEC, we have mathematically sufficient data to reconstruct!
      if (isFec && receivedShards.length >= targetK) {
        break;
      }
    } catch (err) {
      failedShards.push({ index: i, isParity: isParityShard, error: err.message });
      console.warn(`[FreeHole FEC] Shard ${i} unavailable (${err.message}). Resilient parity will compensate.`);
      onStatusChange({
        code,
        status: 'freenet-downloading-chunks',
        warning: true,
        message: isFec
          ? `⚠️ ${shardLabel} unreachable on peer (${err.message || 'timed out'}). Parity will compensate (${failedShards.length} missed so far).`
          : `⚠️ Chunk #${i + 1} unavailable.`,
        stats: {
          retrieved: receivedShards.length,
          required: targetK,
          total: totalChunks,
          failed: failedShards.length,
        },
      });
    }
  }

  let finalBytes;
  let fecReport = null;

  if (isFec) {
    if (receivedShards.length < targetK) {
      throw new Error(
        `Failed to reconstruct file: only ${receivedShards.length}/${targetK} shards available on Freenet (${failedShards.length} shards unreachable).`
      );
    }

    const receivedIndices = new Set(receivedShards.map((s) => s.index));
    const missingDataIndices = [];
    for (let d = 0; d < targetK; d++) {
      if (!receivedIndices.has(d)) {
        missingDataIndices.push(d);
      }
    }
    const parityShardsUsed = receivedShards.filter((s) => s.index >= targetK).length;
    const hasRecovered = missingDataIndices.length > 0;

    fecReport = {
      recovered: hasRecovered,
      missingDataCount: missingDataIndices.length,
      missingDataIndices,
      parityShardsUsed,
      totalShards,
      targetK,
      intactDataShards: targetK - missingDataIndices.length,
      failedShardsCount: failedShards.length,
    };

    if (hasRecovered) {
      onStatusChange({
        code,
        status: 'freenet-reconstructing',
        message: `🔄 Reed-Solomon Reconstruction: ${missingDataIndices.length} data shard(s) missing from network. Restoring bit-for-bit using ${parityShardsUsed} parity shard(s)...`,
        fecReport,
      });
    }

    finalBytes = decodeFEC(receivedShards, fec);
  } else {
    // Legacy fallback without FEC
    if (receivedShards.length < totalChunks) {
      throw new Error(`Failed to download legacy file: ${totalChunks - receivedShards.length} chunks missing.`);
    }
    const downloadedBytes = new Uint8Array(size);
    let offset = 0;
    for (let i = 0; i < totalChunks; i++) {
      const shard = receivedShards.find((s) => s.index === i);
      if (!shard) throw new Error(`Missing chunk #${i}`);
      downloadedBytes.set(shard.data, offset);
      offset += shard.data.byteLength;
    }
    finalBytes = downloadedBytes;
  }

  const completionMessage = isFec
    ? (fecReport?.recovered
        ? `✅ File 100% restored! Recovered ${fecReport.missingDataCount} missing data shard(s) via Reed-Solomon FEC (${fecReport.parityShardsUsed} parity shards used).`
        : `✅ File downloaded with 100% data integrity! All ${targetK} original data shards intact (0 lost).`)
    : 'File successfully downloaded and decrypted from Freenet!';

  onStatusChange({
    code,
    status: 'completed',
    message: completionMessage,
    fecReport,
  });

  return {
    filename,
    size,
    type,
    data: finalBytes,
    message: completionMessage,
    fecReport,
    file:
      typeof File !== 'undefined'
        ? new File([finalBytes], filename, { type })
        : null,
  };
}
