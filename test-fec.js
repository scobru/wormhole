import {
  encodeFEC,
  decodeFEC,
  regenerateShard,
} from './web/src/shared/fec.js';

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

console.log(`\n🎉 All ${testsPassed}/${testsTotal} FEC tests passed successfully!`);

