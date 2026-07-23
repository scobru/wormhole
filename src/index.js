#!/usr/bin/env node

/**
 * WORMHOLE CLI
 * Trasferimento file P2P da terminale
 *
 * Usage:
 *   wormhole send <file>           # Invia un file
 *   wormhole receive <code>        # Ricevi un file
 *   wormhole list                  # Lista trasferimenti attivi
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
import { GroupService } from 'linda-core';

import { WormholeCore, WormholeStatus } from './core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../web/.env'), quiet: true });

const RELAY_URL = process.env.VITE_RELAY_URL;
const AUTH_TOKEN = process.env.VITE_AUTH_TOKEN;

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
  const peerSet = new Set(DEFAULT_PEERS);

  if (typeof relayUrl === 'string' && relayUrl.trim().length > 0) {
    const sanitized = relayUrl.replace(/\/$/, '');
    peerSet.add(`${sanitized}/zen`);

    if (sanitized.startsWith('http://') || sanitized.startsWith('https://')) {
      const wssPeer = sanitized.replace(/^http/, 'ws');
      peerSet.add(`${wssPeer}/zen`);
    }
  }

  return Array.from(peerSet);
}

class WormholeCLI {
  constructor({ gun, relayUrl, authToken }) {
    this.multicastAddress = '233.255.255.255';
    this.multicastPort = 8765;
    this.spinner = ora();

    this.relayUrl = relayUrl;
    this.authToken = authToken;

    this.groupService = new GroupService(null);

    this.wormhole = new WormholeCore({
      gun,
      onStatusChange: this.handleStatusChange.bind(this),
      onProgress: this.handleProgress.bind(this),
    });
  }

  static async create() {
    const relayUrl = RELAY_URL;
    const authToken = AUTH_TOKEN;

    const peers = await buildPeerList(relayUrl);

    const gun = new ZEN({
      peers,
      localStorage: false,
    });

    return new WormholeCLI({ gun, relayUrl, authToken });
  }

  handleStatusChange({ code, status, message, metadata, fileData }) {
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
        if (this.spinner.isSpinning) {
          this.spinner.text = message;
        } else {
          this.spinner.start(message);
        }
        break;

      case WormholeStatus.SENT:
        // Rendered explicitly in sendFile to ensure instantaneous output
        break;

      case WormholeStatus.COMPLETED:
        if (this.spinner.isSpinning) {
          this.spinner.succeed('Trasferimento P2P completato con successo dal ricevente!');
        }
        console.log(chalk.gray('👋 Arrivederci!\n'));
        setTimeout(() => process.exit(0), 500);
        break;

      case WormholeStatus.ERROR:
        if (this.spinner.isSpinning) {
          this.spinner.fail(`Errore: ${message}`);
        } else {
          console.log(chalk.red(`❌ Errore: ${message}`));
        }
        process.exit(1);
        break;

      case WormholeStatus.FOUND: {
        const sizeInfo = metadata?.size ? ` (${filesize(metadata.size)})` : '';
        const modeInfo = metadata?.mode === 'p2p' ? 'P2P Direct' : 'IPFS Relay';
        this.spinner.succeed(`Trasferimento trovato: ${metadata.filename || 'File'}${sizeInfo} [${modeInfo}]`);
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
      this.spinner.text = `Trasferimento in corso... ${progress}%${sizeStr}`;
    }
  }

  // Invia file
  async sendFile(filePath, mode = 'p2p') {
    if (!fs.existsSync(filePath)) {
      console.log(chalk.red('❌ File non trovato:', filePath));
      return;
    }

    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    this.spinner.start('🚀 Preparazione e cifratura file...');

    try {
      const fileBuffer = fs.readFileSync(filePath);
      const fileBlob = new Blob([fileBuffer]);

      const code = await this.wormhole.send({
        file: fileBlob,
        filename: fileName,
        size: stats.size,
        type: this.getMimeType(filePath),
        relayUrl: this.relayUrl,
        authToken: this.authToken,
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

      console.log('');
      console.log(chalk.bold.cyan('🌌 WORMHOLE P2P TRANSFER'));
      console.log(chalk.gray(`📁 File: ${fileName} (${filesize(stats.size)})`));
      console.log(chalk.gray(`⚡ Modalità: ${mode === 'p2p' ? 'P2P Diretto (WebRTC)' : 'IPFS Relay'}`));

      console.log('\n' + chalk.green.bold('🎯 Condividi questo codice:'));
      console.log(chalk.black.bgWhite.bold(` ${code} `));
      if (copied) {
        console.log(chalk.green('📋 Codice copiato negli appunti!'));
      }

      console.log('\n' + chalk.gray('Comando per il ricevente:'));
      console.log(chalk.cyan(`wormhole receive ${code}`));

      console.log(
        chalk.yellow(
          '\n🔒 Questo codice è anche la chiave di decrittazione end-to-end. Mantienilo segreto.'
        )
      );

      if (mode === 'p2p') {
        console.log(
          chalk.bold.red(
            '\n⚠️  NON chiudere questo terminale fino al completamento del trasferimento!'
          )
        );
      }

      console.log('');
      this.spinner.start(chalk.yellow('⏳ In attesa che il ricevente si connetta e scarichi il file...'));

      // Annuncia il trasferimento sulla rete locale via multicast
      this.announceTransfer(code, fileName, stats.size);
    } catch (error) {
      this.spinner.fail(`❌ Upload fallito: ${error.message}`);
      process.exit(1);
    }
  }

  // Annuncia trasferimento sulla rete locale via multicast
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

  // Ricevi file
  async receiveFile(code) {
    this.spinner.start(`Ricerca del trasferimento per: ${code}...`);

    // 1. Inizia ascolto Multicast locale per scoperta immediata
    this.listenForMulticastTransfer(code);

    // 2. Inizia ricezione via Zen/IPFS
    this.wormhole.receive(code, this.relayUrl);
  }

  // Ascolta messaggi multicast per scoprire trasferimenti locali
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

      // Chiudi il socket dopo 30 secondi se non è stato trovato nulla
      setTimeout(() => {
        try {
          socket.close();
        } catch {
          // ignore socket close error
        }
      }, 30000);
    } catch (error) {
      // Ignora errori multicast
    }
  }

  // Helper per generare un GroupInfo compatibile da una password
  async getGroupInfo(code) {
    const hash = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
    const b64 = Buffer.from(hash).toString('base64');
    return { secret: b64 };
  }

  // Invia un messaggio cifrato
  async sendMessage(code, message, sender = 'CLI') {
    this.spinner.start('Cifratura e invio messaggio...');

    try {
      const groupInfo = await this.getGroupInfo(code);
      const encrypted = await this.groupService.encryptGroupMessage(groupInfo, message);

      this.wormhole.gun.get('wormhole/messages').get(code).set({
        content: encrypted,
        sender: sender,
        timestamp: Date.now(),
      });

      this.spinner.succeed('Messaggio inviato correttamente!');
    } catch (error) {
      this.spinner.fail(`Errore invio: ${error.message}`);
    }
  }

  // Ascolta messaggi cifrati
  async listenForMessages(code) {
    console.log(chalk.blue(`💬 In ascolto di messaggi cifrati per il codice: ${code}`));
    console.log(chalk.gray('(Premi Ctrl+C per uscire)'));

    const seen = new Set();
    const groupInfo = await this.getGroupInfo(code);

    this.wormhole.gun
      .get('wormhole/messages')
      .get(code)
      .map()
      .on(async (data, key) => {
        if (data && data.content && !seen.has(key)) {
          seen.add(key);
          try {
            const decrypted = await this.groupService.decryptGroupMessage(groupInfo, data.content);
            if (decrypted && decrypted !== data.content) {
              const date = new Date(data.timestamp).toLocaleTimeString();
              console.log(
                `\n${chalk.gray(`[${date}]`)} ${chalk.yellow.bold(data.sender)}: ${chalk.white(decrypted)}`
              );
            }
          } catch (e) {
            // Probably data we can't decrypt
          }
        }
      });
  }

  async saveFile(fileData, spinner) {
    const { blob, filename, buffer: dataBuffer } = fileData;
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

      spinner.succeed(`✅ File salvato: ${outputPath}`);
      console.log(chalk.green(`📁 Dimensione: ${filesize(buffer.length)}`));
      console.log(chalk.gray('👋 Arrivederci!\n'));
      setTimeout(() => process.exit(0), 500);
    } catch (error) {
      spinner.fail('❌ Errore nel salvataggio');
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
    console.log(chalk.blue('📋 Trasferimenti attivi:'));
    console.log(chalk.gray('(Funzionalità in sviluppo)'));
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const cli = await WormholeCLI.create();

  if (args.length === 0) {
    console.log(chalk.blue('🌌 WORMHOLE CLI'));
    console.log(chalk.gray('Trasferimento file P2P sicuro\n'));
    console.log('Usage:');
    console.log('  wormhole send <file>     # Invia un file');
    console.log('  wormhole receive <code>  # Ricevi un file');
    console.log('  wormhole msg <code> [nick] [message]  # Messaggistica cifrata');
    console.log('  wormhole list           # Lista trasferimenti');
    return;
  }

  const command = args[0];

  switch (command) {
    case 'send': {
      if (!args[1]) {
        console.log(chalk.red('❌ Specifica il file da inviare'));
        return;
      }
      const mode = args.includes('--ipfs') || args.includes('--relay') ? 'ipfs' : 'p2p';
      await cli.sendFile(args[1], mode);
      break;
    }

    case 'receive':
      if (!args[1]) {
        console.log(chalk.red('❌ Specifica il codice di ricezione'));
        return;
      }
      await cli.receiveFile(args[1]);
      break;

    case 'list':
      await cli.listTransfers();
      break;

    case 'msg':
      if (!args[1]) {
        console.log(chalk.red('❌ Specifica il codice'));
        return;
      }

      if (args.length >= 4) {
        await cli.sendMessage(args[1], args.slice(3).join(' '), args[2]);
        setTimeout(() => process.exit(0), 1000);
      } else if (args.length === 3) {
        await cli.sendMessage(args[1], args[2]);
        setTimeout(() => process.exit(0), 1000);
      } else {
        await cli.listenForMessages(args[1]);
        setInterval(() => { }, 1000);
      }
      break;

    default:
      console.log(chalk.red(`❌ Comando sconosciuto: ${command}`));
  }
}

// Gestione errori
process.on('unhandledRejection', (error) => {
  console.error('💥 Errore:', error.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Arrivederci!'));
  process.exit(0);
});

main();
