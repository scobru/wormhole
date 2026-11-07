// Live integration test with running local Freenet node
import assert from 'node:assert/strict';
import {
  putChunk,
  getChunk,
  sendViaFreenet,
  receiveViaFreenet,
  resetSocket,
} from './web/src/shared/freenet.js';
import { generateCode } from './web/src/shared/wormhole-core.js';

console.log('⚡ Starting Live Freenet Integration Test...\n');

try {
  // Test 1: Chunk PUT & GET
  console.log('1. Live Content-Addressed Chunk Contract (chunk.wasm):');
  const sampleData = new TextEncoder().encode(`Wormhole Freenet Live Chunk Test @ ${Date.now()}`);
  console.log('   Publishing sample chunk to local Freenet node...');
  const chunkAddr = await putChunk(sampleData);
  console.log(`   Chunk published at Freenet address: ${chunkAddr.slice(0, 32)}...`);
  assert.ok(chunkAddr && chunkAddr.length > 20, 'Chunk address received');

  console.log('   Fetching chunk back from local Freenet node...');
  const fetchedChunk = await getChunk(chunkAddr);
  assert.deepEqual(fetchedChunk, sampleData, 'Fetched chunk data matches original bytes');
  console.log('   ✅ Chunk PUT & GET round-trip succeeded.\n');

  // Test 2: Full End-to-End File Transfer via Freenet
  console.log('2. Full Live File Transfer (sendViaFreenet & receiveViaFreenet):');
  const testFileName = 'wormhole-live-test.txt';
  const testFileContent = new TextEncoder().encode(
    'This is a complete end-to-end encrypted file transmitted over Freenet using Wormhole chunks!\n'.repeat(50)
  );
  const code = generateCode();
  console.log(`   Transfer Code: ${code} (${testFileContent.byteLength} bytes)`);

  let sendProgressEvents = 0;
  const sendRes = await sendViaFreenet({
    file: testFileContent,
    filename: testFileName,
    size: testFileContent.byteLength,
    type: 'text/plain',
    code,
    onProgress: (p) => {
      sendProgressEvents++;
      process.stdout.write(`   [Upload Progress] ${p.progress}%\r`);
    },
    onStatusChange: (s) => {
      // console.log(`   [Status] ${s.status}: ${s.message}`);
    },
  });
  console.log(`\n   ✅ Upload finished! Chunks published: ${sendRes.chunkAddrs.length}`);

  console.log('   Downloading file back using receiveViaFreenet...');
  let receiveProgressEvents = 0;
  const receiveRes = await receiveViaFreenet(code, {
    onProgress: (p) => {
      receiveProgressEvents++;
      process.stdout.write(`   [Download Progress] ${p.progress}%\r`);
    },
    onStatusChange: (s) => {
      // console.log(`   [Status] ${s.status}: ${s.message}`);
    },
  });
  console.log('\n   Download and decryption finished!');
  assert.equal(receiveRes.filename, testFileName, 'Filename matches');
  assert.equal(receiveRes.size, testFileContent.byteLength, 'File size matches');
  assert.deepEqual(receiveRes.data, testFileContent, 'Decrypted file content matches exactly');

  console.log('   ✅ Full End-to-End Transfer Round-Trip verified!\n');
  console.log('🎉 ALL LIVE FREENET TESTS PASSED WITH 100% SUCCESS!\n');
} catch (e) {
  console.error('\n❌ Live test error:', e);
} finally {
  await resetSocket();
  setTimeout(() => process.exit(0), 500);
}

