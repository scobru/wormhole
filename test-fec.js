import {
  encodeFEC,
  decodeFEC,
  regenerateShard,
} from './web/src/shared/freenet.js';
import { createGeneratorMatrix, gfMul } from 'freenet-blob/fec';

console.log('🧪 Starting FreeHole Forward Error Correction (FEC) Test Suite...\n');

let testsPassed = 0;
let testsTotal = 0;

function assert(condition, message) {
  testsTotal++;
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    process.exit(1);
  } else {
    console.log(`✅ Passed: ${message}`);
    testsPassed++;
  }
}

// 1. Basic Single Chunk File with 1 Redundant Shard
{
  const text = 'Single small file payload';
  const data = new TextEncoder().encode(text);
  const fec = encodeFEC(data, { shardSize: 512 * 1024, parityCount: 1 });
  assert(fec.k === 1 && fec.m === 1 && fec.totalShards === 2, 'K=1, M=1 configuration correct');

  // Lose shard 0 (original data shard lost!)
  const receivedOnlyParity = [fec.shards[1]];
  const decoded = decodeFEC(receivedOnlyParity, fec);
  const restoredText = new TextDecoder().decode(decoded);
  assert(restoredText === text, 'Recovered K=1 file using only parity shard');
}

// 2. Multi-Chunk File with 33% Parity (K=6, M=2, Total 8 Shards)
{
  const testBytes = new Uint8Array(6 * 1024); // 6 KB
  for (let i = 0; i < testBytes.length; i++) {
    testBytes[i] = (i * 17 + 5) & 0xff;
  }

  const fec = encodeFEC(testBytes, { shardSize: 1024, parityCount: 2 });
  assert(fec.k === 6 && fec.m === 2 && fec.totalShards === 8, 'K=6, M=2 configuration correct');

  // Scenario A: Lose 2 data shards (shard 1 and shard 4)
  const survivingShardsA = fec.shards.filter((s) => s.index !== 1 && s.index !== 4);
  assert(survivingShardsA.length === 6, 'Surviving shards count equals K (6 shards)');

  const restoredA = decodeFEC(survivingShardsA, fec);
  let matchA = true;
  for (let i = 0; i < testBytes.length; i++) {
    if (restoredA[i] !== testBytes[i]) {
      matchA = false;
      break;
    }
  }
  assert(matchA, 'Perfect bit-for-bit recovery when 2 arbitrary data shards are lost');

  // Scenario B: Lose 1 data shard and 1 parity shard
  const survivingShardsB = fec.shards.filter((s) => s.index !== 0 && s.index !== 7);
  const restoredB = decodeFEC(survivingShardsB, fec);
  let matchB = true;
  for (let i = 0; i < testBytes.length; i++) {
    if (restoredB[i] !== testBytes[i]) {
      matchB = false;
      break;
    }
  }
  assert(matchB, 'Perfect recovery when 1 data and 1 parity shard are lost');

  // Scenario C: Chunk Regeneration (Heal lost shard 1 and lost shard 7)
  const healedShard1 = regenerateShard(survivingShardsA, 1, fec);
  assert(
    healedShard1.byteLength === fec.shardSize &&
      healedShard1.every((val, idx) => val === fec.shards[1].data[idx]),
    'Chunk regeneration successfully healed missing data shard #1'
  );

  const healedShard7 = regenerateShard(survivingShardsA, 7, fec);
  assert(
    healedShard7.byteLength === fec.shardSize &&
      healedShard7.every((val, idx) => val === fec.shards[7].data[idx]),
    'Chunk regeneration successfully healed missing parity shard #7'
  );
}

// 3. Stress Test on Large Payload (10 MB, K=20, M=7, Total 27 Shards)
{
  const tenMB = 10 * 1024 * 1024;
  const largeBytes = new Uint8Array(tenMB);
  for (let i = 0; i < tenMB; i += 1024) {
    largeBytes[i] = (i >> 10) & 0xff;
  }

  const t0 = performance.now();
  const fec = encodeFEC(largeBytes, { shardSize: 512 * 1024 }); // K=20, M=7
  const t1 = performance.now();
  console.log(`⏱️ Encoded 10MB into ${fec.k} data + ${fec.m} parity shards in ${(t1 - t0).toFixed(1)}ms`);

  // Simulate loss of 7 random shards (shards 2, 5, 9, 14, 18, 22, 26)
  const lostIndices = [2, 5, 9, 14, 18, 22, 26];
  const received = fec.shards.filter((s) => !lostIndices.includes(s.index));

  const t2 = performance.now();
  const restored = decodeFEC(received, fec);
  const t3 = performance.now();
  console.log(`⏱️ Decoded 10MB with 7 missing shards in ${(t3 - t2).toFixed(1)}ms`);

  assert(restored.byteLength === tenMB, 'Restored length matches 10MB');
  let match = true;
  for (let i = 0; i < 10000; i++) {
    const idx = Math.floor(Math.random() * tenMB);
    if (restored[idx] !== largeBytes[idx]) {
      match = false;
      break;
    }
  }
  assert(match, 'Restored data verified with 10,000 random byte probes');
}

// 4. Regression: Large payload (> 48 MB) stays within GF(2^8) 256-shard limit and decodes from any K shards
{
  const fiftyMB = 50 * 1024 * 1024;
  const largeBytes = new Uint8Array(fiftyMB);
  for (let i = 0; i < fiftyMB; i += 4097) {
    largeBytes[i] = (i * 13 + 7) & 0xff;
  }

  const fec = encodeFEC(largeBytes, { shardSize: 256 * 1024 });
  assert(fec.k === 192 && fec.m === 64 && fec.totalShards === 256, '50MB file capped at K=192, M=64 (total 256 <= GF(2^8))');

  // Drop 5 data shards and shuffle remaining shards before selecting K
  const dropped = new Set([0, 17, 64, 128, 191]);
  const pool = fec.shards.filter((s) => !dropped.has(s.index));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const received = pool.slice(0, fec.k);
  const restored = decodeFEC(received, fec);

  assert(restored.byteLength === fiftyMB, 'Restored 50MB length matches original');
  let match = true;
  for (let i = 0; i < fiftyMB; i += 4097) {
    if (restored[i] !== largeBytes[i]) {
      match = false;
      break;
    }
  }
  assert(match, '50MB payload restored bit-for-bit with 5 missing data shards in random order');
}

// 5. Regression: Legacy > 48 MB manifest (K=200, M=64, totalShards=264) with overflow shards >= 256
{
  const K = 200;
  const M = 64;
  const shardSize = 64;
  const originalSize = K * shardSize;
  const legacyBytes = new Uint8Array(originalSize);
  for (let i = 0; i < originalSize; i++) {
    legacyBytes[i] = (i * 29 + 3) & 0xff;
  }

  const G = createGeneratorMatrix(K, M);
  const dataShards = Array.from({ length: K }, (_, i) =>
    legacyBytes.subarray(i * shardSize, (i + 1) * shardSize)
  );
  const allShards = dataShards.map((data, index) => ({ index, data }));
  for (let p = 0; p < M; p++) {
    const row = G[K + p];
    const parity = new Uint8Array(shardSize);
    for (let d = 0; d < K; d++) {
      const coeff = row[d];
      if (coeff === 0) continue;
      for (let b = 0; b < shardSize; b++) {
        parity[b] ^= gfMul(coeff, dataShards[d][b]);
      }
    }
    allShards.push({ index: K + p, data: parity });
  }

  // Verify legacy bug symptom: shards 256..263 duplicate data shard 0
  assert(
    allShards[256].data.every((v, idx) => v === allShards[0].data[idx]),
    'Legacy K=200, M=64 overflow shards >= 256 match data shard 0'
  );

  // Put shard 0 and overflow shards 256..260 at the front, plus 199 valid shards (1..198 and parity 200, missing 199)
  const fecMeta = { k: K, m: M, total: K + M, originalSize, shardSize };
  const receivedWithDuplicates = [
    allShards[0],
    allShards[256],
    allShards[257],
    allShards[258],
    allShards[259],
    allShards[260],
    ...allShards.slice(1, 199),
    allShards[200],
  ];

  const restored = decodeFEC(receivedWithDuplicates, fecMeta);
  assert(
    restored.byteLength === originalSize &&
      restored.every((v, idx) => v === legacyBytes[idx]),
    'Legacy K=200, M=64 manifest with shard 0 + overflow shards 256..260 + missing data shard 199 decodes bit-for-bit'
  );

  // Also verify recovery when canonical shard 0 was lost and only overflow shard 256 arrived
  const receivedViaOverflow = [
    allShards[256],
    ...allShards.slice(1, 199),
    allShards[200],
  ];
  const restoredOverflow = decodeFEC(receivedViaOverflow, fecMeta);
  assert(
    restoredOverflow.byteLength === originalSize &&
      restoredOverflow.every((v, idx) => v === legacyBytes[idx]),
    'Legacy K=200, M=64 manifest recovers shard 0 via overflow shard 256 when shard 0 is missing'
  );
}

console.log(`\n🎉 All ${testsPassed}/${testsTotal} FEC tests passed successfully!`);

