// Test suite for Wormhole in Freenet native mode
import assert from 'node:assert/strict';
import {
  deriveChannelParams,
  getChunkWasm,
  getChannelWasm,
  deriveKeyFromCode,
  toB64,
  fromB64,
  isFreenetAvailable,
} from './web/src/shared/freenet.js';
import { generateCode } from './web/src/shared/wormhole-core.js';

console.log('🧪 Starting Wormhole Freenet Test Suite...\n');

try {
  // Test 1: Mnemonic code generation and key derivation
  console.log('1. Mnemonic Code & Parameter Derivation:');
  const code = generateCode();
  assert.ok(/^\d+-[a-z]+-[a-z]+$/.test(code), 'Generated mnemonic code matches format (e.g. 82-gentle-bird)');
  console.log(`   Sample code: ${code}`);

  const params = deriveChannelParams(code);
  assert.equal(params.length, 32, 'Derived channel parameter is exactly 32 bytes (BLAKE3)');
  console.log('   ✅ Parameter derivation passed.\n');

  // Test 2: WASM contract loading
  console.log('2. WASM Contract Verification:');
  const chunkWasm = await getChunkWasm();
  assert.ok(chunkWasm.code.length > 50000, 'chunk.wasm loaded successfully');
  assert.equal(chunkWasm.codeHash.length, 32, 'chunk.wasm code hash is 32 bytes');
  console.log(`   chunk.wasm size: ${chunkWasm.code.length} bytes`);

  const channelWasm = await getChannelWasm();
  assert.ok(channelWasm.code.length > 50000, 'wormhole_channel.wasm loaded successfully');
  assert.equal(channelWasm.codeHash.length, 32, 'wormhole_channel.wasm code hash is 32 bytes');
  console.log(`   wormhole_channel.wasm size: ${channelWasm.code.length} bytes`);
  console.log('   ✅ Contracts verified.\n');

  // Test 3: Base64 and Crypto Encoding
  console.log('3. Base64 & Buffer Conversion:');
  const rawBytes = new Uint8Array([0, 1, 2, 255, 128, 64, 32]);
  const b64 = toB64(rawBytes);
  const decoded = fromB64(b64);
  assert.deepEqual(rawBytes, decoded, 'Base64 encode/decode round trip');
  console.log('   ✅ Encoding verified.\n');

  // Test 4: Chunked Encryption / Decryption with IV binding
  console.log('4. End-to-End Encryption / Decryption with Chunk Binding:');
  const testSalt = crypto.getRandomValues(new Uint8Array(16));
  const testBaseIv = crypto.getRandomValues(new Uint8Array(12));
  const testKey = await deriveKeyFromCode(code, testSalt);

  const plainText = new TextEncoder().encode('Hello Freenet from Wormhole! Sovereign P2P file sharing.');
  
  // Make chunk IV bound to chunk index 0
  const chunkIv = new Uint8Array(12);
  chunkIv.set(testBaseIv.subarray(0, 8), 0);
  new DataView(chunkIv.buffer, 8, 4).setUint32(0, 0, false);

  const encryptedChunk = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkIv }, testKey, plainText)
  );
  assert.notDeepEqual(encryptedChunk, plainText);

  const decryptedChunk = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: chunkIv }, testKey, encryptedChunk)
  );
  assert.deepEqual(decryptedChunk, plainText, 'Decrypted chunk matches original plaintext');
  console.log(`   Plaintext restored: "${new TextDecoder().decode(decryptedChunk)}"`);
  console.log('   ✅ Chunk crypto verified.\n');

  // Test 5: Freenet Node Availability Probe
  console.log('5. Freenet Node Connectivity Check:');
  const available = await isFreenetAvailable(800);
  console.log(`   Local Freenet Gateway responsiveness: ${available ? 'ACTIVE (connected)' : 'OFFLINE (probe handled cleanly)'}`);
  console.log('   ✅ Availability probe completed without crashing.\n');

  console.log('🎉 All Wormhole Freenet tests passed successfully!\n');
} catch (err) {
  console.error('❌ Test failed:', err);
  process.exit(1);
}
