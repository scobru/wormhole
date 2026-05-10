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

import { WormholeCore, WormholeStatus } from './core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../web/.env') });

const RELAY_URL = process.env.VITE_RELAY_URL;
const AUTH_TOKEN = process.env.VITE_AUTH_TOKEN;

const DEFAULT_PEERS = [
  'https://shogun-relay.scobrudot.dev/zen'
];

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

// Zen handles headers and authentication differently, skipping Gun-specific opt hook


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
        if (this.spinner.isSpinning) {
          this.spinner.text = message;
        } else {
          this.spinner.start(message);
        }
        break;
      case WormholeStatus.UNPINNING:
        if (this.spinner.isSpinning) {
          this.spinner.stop();
        }
        console.log(chalk.gray(message));
        break;
      case WormholeStatus.SENT:
        this.spinner.succeed(message);
        console.log(chalk.green.bold('\n🎯 Condividi questo codice:'));
        console.log(chalk.black.bgWhite(` ${code} `));
        console.log(chalk.gray('\nComando per il ricevente:'));
        console.log(chalk.cyan(`wormhole receive ${code}`));
        console.log(
          chalk.yellow(
            '\nQuesto codice è anche la chiave di decrittazione end-to-end. Mantienilo segreto.'
          )
        );
        console.log(chalk.yellow('\n⏳ In attesa del ricevente...'));
        break;
      case WormholeStatus.COMPLETED:
        this.spinner.succeed(message);
        setTimeout(() => process.exit(0), 1000);
        break;
      case WormholeStatus.ERROR:
        if (this.spinner.isSpinning) {
          this.spinner.fail(message);
        } else {
          this.spinner.stop();
          console.log(chalk.red(message));
        }
        process.exit(1);
        break;
      case WormholeStatus.CONNECTING:
        if (this.spinner.isSpinning) {
          this.spinner.text = message;
        } else {
          this.spinner.start(message);
        }
        break;
      case WormholeStatus.FOUND: {
        const sizeInfo = metadata?.size ? ` (${filesize(metadata.size)})` : '';
        this.spinner.succeed(
          `${message || 'Trasferimento trovato'}${sizeInfo}`
        );
        break;
      }
      case WormholeStatus.DOWNLOADING:
      case WormholeStatus.DECRYPTING:
        if (this.spinner.isSpinning) {
          this.spinner.text = message;
        } else {
          this.spinner.start(message);
        }
        break;
      case WormholeStatus.DOWNLOADED:
        this.saveFile(fileData, this.spinner);
        break;
      case WormholeStatus.UNPINNED:
        if (this.spinner.isSpinning) {
          this.spinner.succeed(message);
        } else {
          console.log(chalk.gray(message));
        }
        break;
      case WormholeStatus.NOTICE:
        if (this.spinner.isSpinning) {
          this.spinner.stop();
        }
        console.log(chalk.yellow(message));
        break;
      default:
        if (message) {
          if (this.spinner.isSpinning) {
            this.spinner.text = message;
          } else {
            console.log(message);
          }
        }
    }
  }

  handleProgress({ progress, loaded, total }) {
    const loadedSize = filesize(loaded || 0);
    const totalSize = filesize(total || 0);
    this.spinner.text = `Downloading... ${progress}% (${loadedSize} / ${totalSize})`;
  }

  // Invia file
  async sendFile(filePath) {
    if (!fs.existsSync(filePath)) {
      console.log(chalk.red('❌ File non trovato:', filePath));
      return;
    }

    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    console.log(chalk.blue('🚀 Preparazione trasferimento...'));
    console.log(chalk.gray(`📁 File: ${fileName}`));
    console.log(chalk.gray(`📏 Dimensione: ${filesize(stats.size)}`));

    this.spinner.start('Uploading file to IPFS via relay...');

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
      });

      this.spinner.succeed('File uploaded to IPFS!');

      try {
        await clipboardy.write(code);
        console.log(chalk.green('📋 Codice copiato negli appunti!'));
      } catch (e) {
        // Ignore clipboard errors
      }

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
            if (err) {
              // console.error(chalk.yellow('⚠️ Impossibile annunciare sulla rete locale'));
            } else {
              // console.log(chalk.gray('📡 Annunciato sulla rete locale'));
            }
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
            console.log(
              chalk.blue(`📡 Scoperto trasferimento locale da ${rinfo.address}!`)
            );
            // I dati Zen dovrebbero arrivare comunque, ma questo conferma che il peer è online
          }
        } catch (e) {
          // Ignore parse errors
        }
      });

      socket.bind(this.multicastPort, () => {
        try {
          socket.addMembership(this.multicastAddress);
        } catch (e) {
          // console.error("Errore addMembership:", e);
        }
      });

      // Chiudi il socket dopo 30 secondi se non è stato trovato nulla
      setTimeout(() => {
        try {
          socket.close();
        } catch (e) { }
      }, 30000);
    } catch (error) {
      // Ignora errori multicast
    }
  }

  // Invia un messaggio cifrato
  async sendMessage(code, message) {
    this.spinner.start('Cifratura e invio messaggio...');

    try {
      const encrypted = await ZEN.encrypt(message, code);

      this.wormhole.gun.get('wormhole/messages').get(code).set({
        content: encrypted,
        sender: 'CLI',
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

    this.wormhole.gun
      .get('wormhole/messages')
      .get(code)
      .map()
      .on(async (data) => {
        if (data && data.content) {
          try {
            const decrypted = await ZEN.decrypt(data.content, code);
            if (decrypted) {
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
      // Use buffer directly if available (CLI optimization), otherwise fallback to Blob
      const buffer = dataBuffer
        ? Buffer.from(dataBuffer)
        : Buffer.from(await blob.arrayBuffer());

      // Sanitize filename to prevent path traversal
      const safeFilename = path.basename(filename);
      let outputPath = safeFilename;
      let counter = 1;

      // Evita sovrascrittura
      while (fs.existsSync(outputPath)) {
        const ext = path.extname(safeFilename);
        const name = path.basename(safeFilename, ext);
        outputPath = `${name} (${counter})${ext}`;
        counter++;
      }

      fs.writeFileSync(outputPath, buffer);

      spinner.succeed(`✅ File salvato: ${outputPath}`);
      console.log(chalk.green(`📁 Dimensione: ${filesize(buffer.length)}`));
      setTimeout(() => process.exit(0), 500);
    } catch (error) {
      spinner.fail('❌ Errore nel salvataggio');
      console.error(chalk.red(error.message));
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

  // Lista trasferimenti attivi (placeholder)
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
    console.log('  wormhole msg <code> [m]  # Messaggistica cifrata');
    console.log('  wormhole list           # Lista trasferimenti');
    return;
  }

  const command = args[0];

  switch (command) {
    case 'send':
      if (!args[1]) {
        console.log(chalk.red('❌ Specifica il file da inviare'));
        return;
      }
      await cli.sendFile(args[1]);
      break;

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
      if (args[2]) {
        // Se c'è un terzo argomento, invia e basta
        await cli.sendMessage(args[1], args.slice(2).join(' '));
      } else {
        // Altrimenti mettiti in ascolto
        await cli.listenForMessages(args[1]);
        // Tieni il processo in vita per ascoltare i messaggi
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
