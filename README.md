# 🌌 Shogun Wormhole

Shogun Wormhole is a secure P2P file transfer tool built with GunDB, offering both a CLI interface and a web interface for seamless file sharing.

## Features

- 🔒 End-to-end secure file transfers
- 🌐 P2P architecture using GunDB
- 📁 IPFS-based file storage
- 🖥️ CLI interface for terminal usage
- 🎨 Modern web interface
- 🔗 Simple sharing with human-readable codes
- 🚀 Progress tracking and status updates
- 🔄 Automatic cleanup after transfers

## Installation

### CLI Tool

```bash
# Install globally
npm install -g gundb-wormhole

# Or run directly with npx
npx gundb-wormhole
```

### Web Interface

```bash
# Clone the repository
git clone https://github.com/yourusername/shogun-wormhole.git

# Install dependencies
cd shogun-wormhole
npm install

# Start the web interface
npm start
```

## Usage

### CLI Interface

```bash
# Send a file
gwh send <file>

# Receive a file
gwh receive <code>

# List active transfers
gwh list
```

### Web Interface

1. Open `http://localhost:3000` in your browser
2. Choose "Send" or "Receive"
3. For sending:
   - Drop a file or click to select
   - Share the generated code with the recipient
4. For receiving:
   - Enter the code provided by the sender
   - The file will download automatically

## Architecture

### Core Components

#### WormholeCore (`core.js`)

The core module handles the file transfer logic:

- File chunking and reassembly
- GunDB synchronization
- IPFS integration
- Progress tracking
- Status management

```javascript
const wormhole = new WormholeCore({
  gun: gunInstance,
  onStatusChange: handleStatus,
  onProgress: handleProgress
});

// Send a file
const code = await wormhole.send({
  file: fileBlob,
  relayUrl: "https://relay.example.com",
  authToken: "your-token"
});

// Receive a file
wormhole.receive(code, relayUrl);
```

#### CLI Interface (`index.js`)

The CLI tool provides terminal-based access:

- File sending/receiving via command line
- Progress spinners and status updates
- Local network discovery via multicast
- Error handling and recovery

#### Web Interface (`interface/index.html`)

Modern web UI built with:

- DaisyUI components
- Tailwind CSS styling
- Drag-and-drop support
- Real-time progress updates
- Responsive design

## Status Codes

The system uses various status codes to track transfer progress:

| Status      | Description                           |
|-------------|---------------------------------------|
| uploading   | File is being uploaded to IPFS        |
| pinning     | Waiting for IPFS pin confirmation     |
| sent        | File ready for recipient              |
| connecting  | Searching for transfer                |
| downloading | File download in progress             |
| completed   | Transfer successfully completed        |
| error       | An error occurred                     |

## Configuration

### Environment Variables

- `RELAY_URL`: IPFS relay server URL
- `AUTH_TOKEN`: Authentication token for relay
- `MULTICAST_ADDRESS`: Local network discovery address
- `MULTICAST_PORT`: Local network discovery port

### GunDB Peers

Default peers:
- `https://peer.wallie.io/gun`
- `https://gun-manhattan.herokuapp.com/gun`

## Security

- Files are transferred through IPFS with temporary pinning
- Automatic cleanup after successful transfers
- No direct P2P connection required between sender and receiver
- Human-readable codes are randomly generated and unique

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Credits

Built with:
- [GunDB](https://gun.eco/)
- [IPFS](https://ipfs.io/)
- [DaisyUI](https://daisyui.com/)
- [Tailwind CSS](https://tailwindcss.com/)
