# 🌌 WORMHOLE

A high-performance, decentralised P2P file transfer and encrypted messaging tool. WORMHOLE provides end-to-end encrypted sharing through both a CLI interface and a modern web dashboard.

## 🚀 Overview

WORMHOLE uses a hybrid architecture for reliable and privacy-focused communication:
- **ZEN Protocol**: For real-time metadata exchange, presence, status synchronization, and decentralized identity.
- **IPFS Relay**: For temporary, secure hosting of encrypted file chunks.
- **E2E Encryption**: All files and messages are encrypted on the client using AES-GCM or ZEN before transmission.
- **Local Discovery**: Automatic peer finding on local networks via UDP Multicast.

---

## 🛠️ Features

- 🔐 **End-to-End Secure (E2EE)**: Files and messages are encrypted with the transfer code as the key.
- 💬 **Encrypted Chat**: Real-time messaging between peers using the same mnemonic code.
- 📦 **Shared Core**: Identical transfer logic across CLI and Web for consistent performance.
- 🔗 **Mnemonic Codes**: Simple, human-readable sharing codes (e.g., `5-brave-fire`).
- 🏎️ **LAN Discovery**: Super-fast peer discovery on local networks using Multicast (UDP).
- 🔄 **Auto Cleanup**: Files are automatically unpinned and metadata cleared after transfers.

---

## 💻 CLI Interface

### Installation

```bash
# Global installation
npm install -g wormhole

# Or run instantly with npx
npx wormhole send <file-path>
```

### Commands

| Command | Description |
|---------|-------------|
| `wormhole send <file>` | Encrypts and uploads a file, generating a sharing code. |
| `wormhole receive <code>` | Downloads and decrypts a file using the provided code. |
| `wormhole msg <code>` | Starts an encrypted chat listener for the given code. |
| `wormhole msg <code> <text>` | Sends a single encrypted message and exits. |
| `wormhole list` | Lists currently active transfers (experimental). |

---

## 🌐 Web Application

### Local Development

1. Navigate to the web directory:
   ```bash
   cd web
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```

The web interface will be available at `http://localhost:5173` (default Vite port).

---

## 🏗️ Project Structure

```text
wormhole/
├── src/
│   ├── index.js              # CLI Application
│   └── core.js               # CLI proxy for shared logic
├── web/
│   ├── src/
│   │   ├── shared/
│   │   │   └── wormhole-core.js # SHARED LOGIC (Encryption, ZEN, IPFS)
│   │   └── main.js           # Frontend Logic
│   └── index.html            # Web Entry Point
├── package.json              # Main project config and CLI binary
└── output.txt                # System diagnostics / Debug output
```

---

## ⚙️ Configuration

The application uses environment variables for relay and authorization configuration.

| Variable | Description |
|----------|-------------|
| `VITE_RELAY_URL` | The URL of the IPFS relay. |
| `VITE_AUTH_TOKEN` | Bearer token for authorized upload access to the relay. |

---

## 🛡️ Security & Privacy

1. **Protocol Isolation**: Relays only see encrypted chunks; they never see filenames or keys.
2. **Deterministic Keys**: Cryptographic keys are derived from the mnemonic code using PBKDF2/ZEN.
3. **No Central Logs**: All coordination happens on the decentralized ZEN network.
4. **Instant Cleanup**: Successful transfers trigger an `unpin` request to the IPFS relay.

---

Built with ❤️ by [scobru](https://github.com/scobru).  
*Securing the decentralized web, one chunk at a time.*
