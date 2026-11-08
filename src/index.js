#!/usr/bin/env node

/**
 * FREEHOLE CLI
 * Sovereign decentralized file transfer from terminal
 *
 * Usage:
 *   freehole send <file>           # Send a file
 *   freehole receive <code>        # Receive a file
 *   freehole list                  # List active transfers
 */

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ora from 'ora';
import clipboardy from 'clipboardy';
import { filesize } from 'filesize';
import dgram from 'dgram';
import ZEN from 'zen';

// Suppress internal Gun / ZEN verbose logs
if (ZEN && typeof ZEN === 'function') {
  const noop = () => {};
  noop.once = () => {};
  ZEN.log = noop;
}

import { webcrypto } from 'crypto';
if (!globalThis.window) {
  globalThis.window = { crypto: webcrypto };
}

import polyfill from 'node-datachannel/polyfill';
if (!globalThis.RTCPeerConnection) {
  Object.assign(globalThis, polyfill);
}
import { WormholeCore, WormholeStatus } from './core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import dotenv from 'dotenv';
const envPaths = [
  path.join(__dirname, '../.env'),
  path.join(__dirname, '../web/.env'),
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, quiet: true });
  }
}

const DEFAULT_RELAY_URL = 'https://delay.scobrudot.dev';
const DEFAULT_AUTH_TOKEN = 'shogun2025';

const RELAY_URL = process.env.VITE_RELAY_URL || DEFAULT_RELAY_URL;
const AUTH_TOKEN = process.env.VITE_AUTH_TOKEN || DEFAULT_AUTH_TOKEN;

const DEFAULT_PEERS = ['https://delay.scobrudot.dev/zen'];

// Intercept noisy console output from dependencies
function setupCleanTerminalLogs() {
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;

  const noiseKeywords = [
    'localStorage',
    'AXE relay',
    'DHT k-buckets',
    'Multicast udp',
    'injected env',
    'Dati ricevuti da Gun',
    'Attendo dati da Gun',
    'Inizio receive per codice',
    'Dati salvati su Gun',
    'Metadati cifratura',
    'TIMEOUT: Nessun dato',
  ];

  function isNoise(args) {
    if (!args || args.length === 0) return false;
    const str = args.map((a) => (typeof a === 'string' ? a : (a && a.message) || String(a))).join(' ');
    return noiseKeywords.some((kw) => str.includes(kw));
  }

  console.log = (...args) => {
    if (!isNoise(args)) origLog(...args);
  };
  console.warn = (...args) => {
    if (!isNoise(args)) origWarn(...args);
  };
  console.error = (...args) => {
    if (!isNoise(args)) origError(...args);
  };
}

setupCleanTerminalLogs();

async function buildPeerList(relayUrl) {
  const peerSet = new Set();

  if (typeof relayUrl === 'string' && relayUrl.trim().length > 0) {
    const sanitized = relayUrl.replace(/\/$/, '');
    peerSet.add(`${sanitized}/zen`);
  }

  DEFAULT_PEERS.forEach((p) => peerSet.add(p));

  return Array.from(peerSet);
}

class WormholeCLI {
  constructor({ gun, relayUrl, authToken }) {
    this.multicastAddress = '233.255.255.255';
    this.multicastPort = 8765;
    this.spinner = ora();

    this.relayUrl = relayUrl;
    this.authToken = authToken;

    this.wormhole = new WormholeCore({
      gun,
      onStatusChange: this.handleStatusChange.bind(this),
      onProgress: this.handleProgress.bind(this),
    });
  }

  static async create(options = {}) {
    const relayUrl = options.relayUrl || RELAY_URL;
    const authToken = options.authToken || AUTH_TOKEN;

    let gun = null;
    try {
      const peers = await buildPeerList(relayUrl);
      gun = new ZEN({
        peers,
        localStorage: false,
      });
    } catch (_) {
      // ZEN is optional when using pure Freenet mode
    }

    return new WormholeCLI({ gun, relayUrl, authToken });
  }

  handleStatusChange({ code, status, message, metadata, fileData, warning, fecReport }) {
    switch (status) {
      case WormholeStatus.CHECKING_RELAY:
      case WormholeStatus.ENCRYPTING:
      case WormholeStatus.UPLOADING:
      case WormholeStatus.PINNING:
      case WormholeStatus.WAITING_PEER:
      case WormholeStatus.STREAMING_P2P:
      case WormholeStatus.CONNECTING:
      case WormholeStatus.DOWNLOADING:
      case WormholeStatus.DECRYPTING:
      case WormholeStatus.FREENET_UPLOADING_CHUNKS:
      case WormholeStatus.FREENET_PUBLISHING_MANIFEST:
      case WormholeStatus.FREENET_RESOLVING_MANIFEST:
      case WormholeStatus.FREENET_DOWNLOADING_CHUNKS:
      case WormholeStatus.FREENET_RECONSTRUCTING:
      case 'freenet-reconstructing':
        if (warning) {
          if (this.spinner.isSpinning) {
            this.spinner.warn(chalk.yellow(message));
            this.spinner.start(chalk.cyan('Continuing retrieval with resilient parity...'));
          } else {
            console.log(chalk.yellow(message));
          }
        } else if (this.spinner.isSpinning) {
          this.spinner.text = message;
        } else {
          this.spinner.start(message);
        }
        break;

      case WormholeStatus.SENT:
        // Rendered explicitly in sendFile to ensure instantaneous output
        break;

      case WormholeStatus.COMPLETED:
        if (fileData) {
          this.saveFile({ ...fileData, fecReport: fileData?.fecReport || fecReport }, this.spinner);
        } else {
          if (this.spinner.isSpinning) {
            this.spinner.succeed(message || 'Transfer completed successfully!');
          }
          console.log(chalk.gray('👋 Goodbye!\n'));
          setTimeout(() => process.exit(0), 500);
        }
        break;

      case WormholeStatus.ERROR:
        if (this.spinner.isSpinning) {
          this.spinner.fail(`Error: ${message}`);
        } else {
          console.log(chalk.red(`❌ Error: ${message}`));
        }
        process.exit(1);
        break;

      case WormholeStatus.FOUND: {
        const sizeInfo = metadata?.size ? ` (${filesize(metadata.size)})` : '';
        const modeInfo = metadata?.mode === 'p2p' ? 'P2P Direct' : 'IPFS Relay';
        this.spinner.succeed(`Transfer found: ${metadata.filename || 'File'}${sizeInfo} [${modeInfo}]`);
        break;
      }

      case WormholeStatus.DOWNLOADED:
        this.saveFile(fileData, this.spinner);
        break;

      case WormholeStatus.UNPINNING:
      case WormholeStatus.UNPINNED:
      case WormholeStatus.NOTICE:
        break;

      default:
        if (message && this.spinner.isSpinning) {
          this.spinner.text = message;
        }
    }
  }

  handleProgress({ progress, loaded, total }) {
    if (this.spinner.isSpinning) {
      const loadedStr = loaded ? filesize(loaded) : '';
      const totalStr = total ? filesize(total) : '';
      const sizeStr = loadedStr && totalStr ? ` (${loadedStr} / ${totalStr})` : '';
      this.spinner.text = `Transfer in progress... ${progress}%${sizeStr}`;
    }
  }

  // Send file
  async sendFile(filePath, mode = 'p2p', options = {}) {
    if (!fs.existsSync(filePath)) {
      console.log(chalk.red('❌ File not found:', filePath));
      return;
    }

    const relayUrl = options.relayUrl || this.relayUrl;
    const authToken = options.authToken || this.authToken;

    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    this.spinner.start('🚀 Preparing and encrypting file...');

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const fileBlob = new Blob([fileBuffer]);

      const code = await this.wormhole.send({
        file: fileBlob,
        filename: fileName,
        size: stats.size,
        type: this.getMimeType(filePath),
        relayUrl: relayUrl,
        authToken: authToken,
        lastModified: stats.mtimeMs,
        mode: mode,
      });

      this.spinner.stop();

      let copied = false;
      try {
        await clipboardy.write(code);
        copied = true;
      } catch (e) {
        // Ignore clipboard write error
      }

      const modeLabel =
        mode === 'freenet'
          ? 'Freenet Decentralized Storage (Chunk Contracts)'
          : mode === 'p2p'
            ? 'Direct P2P (WebRTC)'
            : 'IPFS Relay';

      console.log('');
      console.log(chalk.bold.cyan('🌌 FREEHOLE FILE TRANSFER'));
      console.log(chalk.gray(`📁 File: ${fileName} (${filesize(stats.size)})`));
      console.log(chalk.gray(`⚡ Mode: ${modeLabel}`));

      console.log('\n' + chalk.green.bold('🎯 Share this sync code:'));
      console.log(chalk.black.bgWhite.bold(` ${code} `));
      if (copied) {
        console.log(chalk.green('📋 Code copied to clipboard!'));
      }

      console.log('\n' + chalk.gray('Receiver command:'));
      console.log(chalk.cyan(`freehole receive ${code}${mode === 'freenet' ? ' --freenet' : ''}`));

      console.log(
        chalk.yellow(
          '\n🔒 This sync code is also the end-to-end decryption key. Keep it secret.'
        )
      );

      if (mode === 'freenet') {
        console.log(
          chalk.green(
            '\n✨ File stored on the decentralized Freenet network!'
          )
        );
        console.log(
          chalk.gray(
            '💡 The recipient can download the file at any time using this sync code.'
          )
        );
        console.log(chalk.gray('👋 You can safely close this terminal.\n'));
        setTimeout(() => process.exit(0), 1000);
        return;
      }

      if (mode === 'p2p') {
        console.log(
          chalk.bold.red(
            '\n⚠️  Do NOT close this terminal until the transfer is complete!'
          )
        );
      }

      console.log('');
      this.spinner.start(chalk.yellow('⏳ Waiting for recipient to connect and download...'));

      // Announce transfer on local network via multicast
      this.announceTransfer(code, fileName, stats.size);

      // Keep CLI process alive
      setInterval(() => {}, 1000);
    } catch (error) {
      this.spinner.fail(`❌ Upload failed: ${error.message}`);
      process.exit(1);
    }
  }

  // Announce transfer on local network via multicast
  announceTransfer(code, filename, size) {
    try {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      const message = JSON.stringify({
        type: 'wormhole-announce',
        code: code,
        filename: filename,
        size: size,
        timestamp: Date.now(),
      });

      socket.bind(() => {
        socket.setBroadcast(true);
        socket.setMulticastTTL(128);

        socket.send(
          message,
          0,
          message.length,
          this.multicastPort,
          this.multicastAddress,
          (err) => {
            socket.close();
          }
        );
      });
    } catch (error) {
      // Ignora errori di multicast, non critici per il funzionamento
    }
  }

  // Receive file
  async receiveFile(code, options = {}) {
    const relayUrl = options.relayUrl || this.relayUrl;
    const mode = options.mode || 'auto';
    this.spinner.start(`Searching transfer for: ${code}...`);

    if (mode !== 'freenet') {
      // 1. Begin local multicast listening for instant discovery
      this.listenForMulticastTransfer(code);
    }

    // 2. Begin receiving via Freenet or Zen/IPFS
    this.wormhole.receive(code, relayUrl, mode);

    // Keep CLI process alive
    setInterval(() => {}, 1000);
  }

  // Listen for multicast messages to discover local transfers
  listenForMulticastTransfer(targetCode) {
    try {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      socket.on('message', (msg, rinfo) => {
        try {
          const data = JSON.parse(msg.toString());
          if (
            data.type === 'wormhole-announce' &&
            data.code === targetCode &&
            !this.localDiscoveryFound
          ) {
            this.localDiscoveryFound = true;
          }
        } catch (e) {
          // Ignore parse errors
        }
      });

      socket.bind(this.multicastPort, () => {
        try {
          socket.addMembership(this.multicastAddress);
        } catch (e) {
          // Ignore membership errors
        }
      });

      // Close socket after 30 seconds if nothing was found
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          // ignore socket close error
        }
      }, 30000);
    } catch (error) {
      // Ignore multicast errors
    }
  }



  async saveFile(fileData, spinner) {
    const { blob, filename, buffer: dataBuffer, fecReport } = fileData;
    try {
      const buffer = dataBuffer
        ? Buffer.from(dataBuffer)
        : Buffer.from(await blob.arrayBuffer());

      const safeFilename = path.basename(filename);
      let outputPath = safeFilename;
      let counter = 1;

      while (fs.existsSync(outputPath)) {
        const ext = path.extname(safeFilename);
        const name = path.basename(safeFilename, ext);
        outputPath = `${name} (${counter})${ext}`;
        counter++;
      }

      fs.writeFileSync(outputPath, buffer);

      spinner.succeed(`✅ File saved: ${outputPath}`);
      console.log(chalk.green(`📁 Size: ${filesize(buffer.length)}`));

      if (fecReport) {
        console.log('');
        console.log(chalk.bold.magenta('🛡️  REED-SOLOMON FEC INTEGRITY REPORT:'));
        if (fecReport.recovered) {
          console.log(chalk.yellow(`   ⚠️  Missing shards on network: ${fecReport.missingDataCount} data shard(s)`));
          console.log(chalk.cyan(`   🔧 Parity shards used:        ${fecReport.parityShardsUsed} Reed-Solomon shard(s)`));
          console.log(chalk.green.bold(`   ✅ File bit-for-bit restored: 100% data integrity verified`));
        } else {
          console.log(chalk.green(`   ✅ Clean download: All ${fecReport.targetK} original data shards intact (0 lost)`));
          console.log(chalk.gray(`   ✅ Redundancy: 0 parity shards needed (clean network retrieval)`));
        }
        console.log('');
      }

      console.log(chalk.gray('👋 Goodbye!\n'));
      setTimeout(() => process.exit(0), 500);
    } catch (error) {
      spinner.fail('❌ Error saving file');
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.txt': 'text/plain',
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.zip': 'application/zip',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  async listTransfers() {
    console.log(chalk.blue('📋 Active transfers:'));
    console.log(chalk.gray('(Feature under development)'));
  }
}

function parseFlags(commandArgs) {
  const flags = {
    positional: [],
    mode: 'p2p',
    url: RELAY_URL,
    token: AUTH_TOKEN,
  };

  for (let i = 0; i < commandArgs.length; i++) {
    const arg = commandArgs[i];
    if (arg === '--freenet' || arg === '--fn') {
      flags.mode = 'freenet';
    } else if (arg === '--ipfs' || arg === '--relay') {
      flags.mode = 'ipfs';
    } else if (arg === '--p2p') {
      flags.mode = 'p2p';
    } else if ((arg === '--url' || arg === '-u') && commandArgs[i + 1]) {
      flags.url = commandArgs[++i];
    } else if ((arg === '--token' || arg === '-t') && commandArgs[i + 1]) {
      flags.token = commandArgs[++i];
    } else if (!arg.startsWith('-')) {
      flags.positional.push(arg);
    }
  }

  return flags;
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(chalk.blue('🌌 FREEHOLE CLI'));
    console.log(chalk.gray('Secure P2P, IPFS & Freenet sovereign file transfer\n'));
    console.log('Usage:');
    console.log('  fh send <file> [options]     # Send a file (or: freehole)');
    console.log('  fh receive <code> [options]  # Receive a file');
    console.log('  fh list                      # List transfers\n');
    console.log('Transfer options:');
    console.log('  --freenet, --fn              Send or receive via decentralized Freenet network');
    console.log('  --p2p                        Send via direct WebRTC P2P (default)');
    console.log('  --ipfs, --relay              Send via IPFS relay instead of direct P2P');
    console.log('  -u, --url <url>              Specify IPFS relay URL (default: from .env or https://delay.scobrudot.dev)');
    console.log('  -t, --token <token>          Specify IPFS relay Bearer token (default: from .env or shogun2025)');
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);
  const flags = parseFlags(commandArgs);

  const cli = await WormholeCLI.create({
    relayUrl: flags.url,
    authToken: flags.token,
    mode: flags.mode,
  });

  switch (command) {
    case 'send': {
      const file = flags.positional[0];
      if (!file) {
        console.log(chalk.red('❌ Please specify the file to send'));
        return;
      }
      await cli.sendFile(file, flags.mode, { relayUrl: flags.url, authToken: flags.token });
      break;
    }

    case 'receive': {
      const code = flags.positional[0];
      if (!code) {
        console.log(chalk.red('❌ Please specify the sync code to receive'));
        return;
      }
      await cli.receiveFile(code, { relayUrl: flags.url, mode: flags.mode });
      break;
    }

    case 'list':
      await cli.listTransfers();
      break;

    default:
      console.log(chalk.red(`❌ Unknown command: ${command}`));
  }
}

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('💥 Error:', error.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Goodbye!'));
  process.exit(0);
});

main();
