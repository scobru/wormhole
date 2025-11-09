#!/usr/bin/env node

/**
 * GunDB Wormhole CLI
 * Trasferimento file P2P da terminale
 *
 * Usage:
 *   gwh send <file>           # Invia un file
 *   gwh receive <code>        # Ricevi un file
 *   gwh list                  # Lista trasferimenti attivi
 */

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import ora from 'ora';
import clipboardy from 'clipboardy';
import { filesize } from 'filesize';
import dgram from 'dgram';
import Gun from 'gun';
import { WormholeCore, WormholeStatus } from './core.js';
import { forceListUpdate } from 'shogun-relays';

class GunWormholeCLI {
  constructor() {
    this.multicastAddress = '233.255.255.255';
    this.multicastPort = 8765;
    this.spinner = ora();

    // The relay used for IPFS upload/download and Gun sync
    this.relayUrl = 'https://5eh4twk2f62autunsje4panime.srv.us';
    this.authToken = 'shogun2025'; // Token for privileged operations like upload

    const relays = forceListUpdate();
    const gun = Gun({
      peers: [this.relayUrl],
      localStorage: false,
      radisk: true,
    });

    this.wormhole = new WormholeCore({
      gun,
      onStatusChange: this.handleStatusChange.bind(this),
      onProgress: this.handleProgress.bind(this),
    });
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
        console.log(chalk.green.bold(`\n🎯 Condividi questo codice:`));
        console.log(chalk.black.bgWhite(` ${code} `));
        console.log(chalk.gray(`\nComando per il ricevente:`));
        console.log(chalk.cyan(`gwh receive ${code}`));
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
        this.saveFile(fileData.blob, fileData.filename, this.spinner);
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
    this.wormhole.receive(code, this.relayUrl);
  }

  async saveFile(blob, filename, spinner) {
    try {
      const buffer = Buffer.from(await blob.arrayBuffer());

      let outputPath = filename;
      let counter = 1;

      // Evita sovrascrittura
      while (fs.existsSync(outputPath)) {
        const ext = path.extname(filename);
        const name = path.basename(filename, ext);
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
  const cli = new GunWormholeCLI();

  if (args.length === 0) {
    console.log(chalk.blue('🌌 GunDB Wormhole CLI'));
    console.log(chalk.gray('Trasferimento file P2P sicuro\n'));
    console.log('Usage:');
    console.log('  gwh send <file>     # Invia un file');
    console.log('  gwh receive <code>  # Ricevi un file');
    console.log('  gwh list           # Lista trasferimenti');
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
