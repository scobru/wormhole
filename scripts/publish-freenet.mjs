#!/usr/bin/env node

/**
 * Freenet Web App Publisher for Wormhole
 * Builds dist/ and publishes or updates the Web Container Contract on Freenet using fdev.
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const KEY_NAME = 'wormhole';

// Find fdev binary
function findFdev() {
  // Check if fdev is in PATH
  try {
    const test = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', ['fdev'], {
      encoding: 'utf8',
    });
    if (test.status === 0 && test.stdout.trim()) {
      return test.stdout.trim().split(/\r?\n/)[0];
    }
  } catch (_) {}

  // Common installation paths
  const candidates = [];
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
    candidates.push(path.join(localAppData, 'Freenet', 'bin', 'fdev.exe'));
    candidates.push(path.join(process.env.USERPROFILE || '', '.cargo', 'bin', 'fdev.exe'));
    candidates.push(path.join(process.env.USERPROFILE || '', '.local', 'bin', 'fdev.exe'));
  } else {
    candidates.push(
      path.join(process.env.HOME || '', '.local', 'bin', 'fdev'),
      path.join(process.env.HOME || '', '.cargo', 'bin', 'fdev'),
      '/usr/local/bin/fdev',
      '/usr/bin/fdev'
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  return 'fdev'; // fallback to PATH
}

const fdevPath = findFdev();
console.log(`🔍 Using Freenet Dev Tool: ${fdevPath}`);

// 1. Build project
console.log('\n📦 Step 1: Building Wormhole Web App for Freenet...');
try {
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
} catch (e) {
  console.error('❌ Build failed.');
  process.exit(1);
}

// Verify dist directory and assets
if (!fs.existsSync(distDir) || !fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('❌ dist/index.html not found! Build output is incomplete.');
  process.exit(1);
}

// 2. Check / Initialize Website Key
console.log('\n🔑 Step 2: Checking Freenet website signing key...');
let websiteKey = null;
try {
  const listOut = execSync(`"${fdevPath}" website list`, { encoding: 'utf8' });
  const lines = listOut.split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === KEY_NAME && parts[1]) {
      websiteKey = parts[1];
      break;
    }
  }
} catch (e) {
  console.warn('⚠️ Unable to list website keys:', e.message);
}

if (!websiteKey) {
  console.log(`✨ Key "${KEY_NAME}" not found. Initializing new website keypair...`);
  try {
    execSync(`"${fdevPath}" website init ${KEY_NAME}`, { cwd: rootDir, stdio: 'inherit' });
    const listOut = execSync(`"${fdevPath}" website list`, { encoding: 'utf8' });
    const match = listOut.split(/\r?\n/).find((l) => l.startsWith(KEY_NAME));
    if (match) {
      websiteKey = match.split(/\s+/)[1];
    }
  } catch (e) {
    console.error('❌ Failed to initialize website key:', e.message);
    process.exit(1);
  }
}

console.log(`✅ Website Key (${KEY_NAME}): ${websiteKey || 'configured'}`);

// 3. Publish or Update
console.log('\n🚀 Step 3: Deploying to Freenet Web Container...');
let success = false;

// Try update first (in case it was already published)
try {
  console.log('🔄 Attempting "fdev website update"...');
  execSync(`"${fdevPath}" website update --key ${KEY_NAME} dist`, {
    cwd: rootDir,
    stdio: 'inherit',
  });
  success = true;
} catch (updateErr) {
  console.log('ℹ️ Update failed (site might not be published yet). Attempting "fdev website publish"...');
  try {
    execSync(`"${fdevPath}" website publish --key ${KEY_NAME} dist`, {
      cwd: rootDir,
      stdio: 'inherit',
    });
    success = true;
  } catch (publishErr) {
    console.error('❌ Failed to deploy website to Freenet:', publishErr.message);
    process.exit(1);
  }
}

if (success) {
  console.log('\n🎉 ========================================================');
  console.log('🌌 WORMHOLE WEB DAPP PUBLISHED ON FREENET!');
  console.log('========================================================');
  if (websiteKey) {
    console.log('\n🔗 Open in your browser (via local Freenet gateway):');
    console.log(`👉 http://127.0.0.1:7509/v1/contract/web/${websiteKey}/`);
  }
  console.log('\n💡 The contract address is permanent and upgrades in place.');
  console.log('========================================================\n');
}

