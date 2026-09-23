# 🌌 WORMHOLE

A high-performance, decentralized P2P and IPFS file transfer tool using **ZEN** and **WebRTC**. WORMHOLE provides end-to-end encrypted file sharing through both a fast CLI interface (`wh`) and a modern web dashboard.

---

## 🚀 Overview & Architecture

WORMHOLE uses a hybrid architecture designed for speed, privacy, and reliability:

1. **⚡ Direct P2P Stream (WebRTC DataChannel)** *(Default Mode)*:
   - Inspired by **FilePizza**, files are streamed directly between peers using binary `RTCDataChannel` (64KB chunks).
   - **Zero Base64 & Zero Graph Flooding**: File chunks travel over UDP/SCTP wire speed, completely bypassing database storage.
   - Built-in flow control and backpressure management (`bufferedAmount`) to maintain low memory overhead even with large files.

2. **📡 Serverless Signaling via ZEN Protocol**:
   - The **ZEN** distributed graph database (Gun) acts as a decentralized rendezvous and signaling bus.
   - Used exclusively for lightweight coordination (~2-3 KB): exchanging mnemonic codes, cryptographic metadata, SDP Offers/Answers, and trickle ICE candidates.
   - **No proprietary WebSocket/Socket.io signaling server required.**

3. **☁️ IPFS Relay ([scobru/delay](https://github.com/scobru/delay))** *(`--ipfs` Mode)*:
   - When direct P2P is unavailable (e.g. restrictive enterprise firewalls) or when asynchronous delivery is needed, files can be staged decentralized on IPFS.
   - Powered by **[delay](https://github.com/scobru/delay)**, the companion IPFS relay and pinning service (`https://delay.scobrudot.dev`).
   - Automatically unpins and clears cached files upon successful receiver confirmation.

4. **🔒 End-to-End Encryption (E2EE)**:
   - All files are encrypted client-side using **AES-GCM (256-bit)** with PBKDF2 key derivation.
   - The human-readable mnemonic code (e.g., `82-gentle-bird`) serves as both the rendezvous key and the decryption key. Relays and network peers never see plaintext or filenames.

5. **🏎️ Local Discovery (LAN)**:
   - Automatic local peer discovery on local networks using UDP Multicast.

---

## 🛠️ Features

- 🔐 **End-to-End Secure**: Zero-knowledge encryption on the sender, decrypted only by the receiver.
- ⚡ **Wire-Speed P2P**: Direct WebRTC DataChannel streaming without intermediaries.
- ☁️ **Decentralized Relay**: Seamless fallback to IPFS via [scobru/delay](https://github.com/scobru/delay).
- 📦 **Shared Universal Core**: Identical crypto, WebRTC, and signaling logic across CLI and Browser.
- 🔗 **Mnemonic Codes**: Easy-to-share words (e.g., `42-brave-fire`).
- 🔄 **Auto Cleanup**: Relay staging automatically requests unpinning after transfer completion.

---

## 💻 CLI Interface (`wh`)

The CLI binary is named **`wh`** to prevent name collisions with `magic-wormhole`.

### Installation

```bash
# Global installation
npm install -g wormhole

# Or run instantly via npx
npx wh send <file-path>
```

### Commands

| Command | Description |
|---------|-------------|
| `wh send <file> [options]` | Encrypts and sends a file via WebRTC P2P (or IPFS relay), outputting a sync code. |
| `wh receive <code> [options]` | Downloads and decrypts a file using the sync code. |
| `wh list` | Lists currently active transfers (experimental). |

### CLI Options

| Option | Shorthand | Description | Default |
|--------|-----------|-------------|---------|
| `--p2p` | | Use direct WebRTC DataChannel streaming. | `true` (Default) |
| `--ipfs`, `--relay` | | Send via IPFS relay instead of direct P2P. | `false` |
| `--url <url>` | `-u` | Custom IPFS relay URL. | `https://delay.scobrudot.dev` |
| `--token <token>` | `-t` | Bearer authentication token for IPFS relay upload. | `shogun2025` |

### Examples

```bash
# 1. Direct WebRTC P2P transfer (Recommended, high speed)
wh send my-video.mp4
wh receive 82-gentle-bird

# 2. Staged transfer via IPFS relay (scobru/delay)
wh send backup.zip --ipfs
wh receive 14-calm-wave

# 3. Using a custom IPFS relay
wh send document.pdf --ipfs -u https://my-relay.example.com -t my_secret_token
```

---

## 🌐 Web Application

### Local Development

1. Navigate to the `web` directory:
   ```bash
   cd web
   yarn install
   ```

2. Start the Vite development server:
   ```bash
   yarn dev
   ```

The web interface will be available at `http://localhost:5173`.

---

## 🏗️ Project Structure

```text
wormhole/
├── src/
│   ├── index.js              # CLI Application (binary: 'wh')
│   └── core.js               # CLI proxy for shared transfer logic
├── web/
│   ├── src/
│   │   ├── shared/
│   │   │   └── wormhole-core.js # UNIVERSAL CORE (Crypto, WebRTC DataChannel, ZEN Signaling, IPFS)
│   │   ├── main.js           # Frontend Logic & UI Controller
│   │   └── core-proxy.js     # Browser alias resolution
│   ├── styles/
│   │   └── wormhole.css      # Design System & Styling
│   └── index.html            # Web Entry Point
├── package.json              # Main project config (defines 'wh' binary)
└── README.md                 # Project Documentation
```

---

## ⚙️ Configuration & Companion Services

WORMHOLE works out of the box with zero configuration, using preconfigured defaults:

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_RELAY_URL` | URL of the IPFS relay backend ([scobru/delay](https://github.com/scobru/delay)). | `https://delay.scobrudot.dev` |
| `VITE_AUTH_TOKEN` | Bearer token for authorized upload to the relay. | `shogun2025` |

### Companion Project: [scobru/delay](https://github.com/scobru/delay)
The IPFS relay backend is powered by **[scobru/delay](https://github.com/scobru/delay)**, a lightweight IPFS upload and pinning microservice that supports:
- Chunked file ingestion (`POST /api/v1/ipfs/upload`)
- Direct streaming download (`GET /api/v1/ipfs/cat/:cid`)
- Temporary cache management and unpinning (`POST /api/v1/ipfs/pin/rm`)

---

## 🛡️ Security & Privacy

1. **Zero-Knowledge Architecture**: The signaling network (ZEN) and the IPFS relay ([scobru/delay](https://github.com/scobru/delay)) only see encrypted bytes. They have no access to filenames, content, or keys.
2. **Ephemeral Signaling**: Signaling keys and metadata on ZEN expire naturally or are cleaned up upon transfer completion.
3. **Automatic Cache Purge**: When using `--ipfs`, completing the download automatically triggers an unpin request to the [delay](https://github.com/scobru/delay) relay.

---

Built with ❤️ by [scobru](https://github.com/scobru).  
*Securing the decentralized web, one chunk at a time.*
