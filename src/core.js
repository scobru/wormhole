// Shared config
const CHUNK_SIZE = 65536; // 64KB chunks

/**
 * Generates a human-readable, mnemonic code.
 * @returns {string} The generated code, e.g., "7-brave-fire".
 */
function generateCode() {
    const adjectives = ['quick', 'lazy', 'happy', 'bright', 'calm', 'wild', 'gentle', 'brave', 'clever', 'kind'];
    const nouns = ['cat', 'dog', 'bird', 'fish', 'tree', 'star', 'moon', 'rock', 'wave', 'fire'];
    const numbers = Math.floor(Math.random() * 100);
    
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    
    return `${numbers}-${adj}-${noun}`;
}

/**
 * Splits a base64 string into chunks.
 * @param {string} base64Data - The base64 encoded data string.
 * @returns {string[]} An array of base64 chunks.
 */
function base64ToChunks(base64Data) {
    const chunks = [];
    for (let i = 0; i < base64Data.length; i += CHUNK_SIZE) {
        chunks.push(base64Data.substring(i, i + CHUNK_SIZE));
    }
    return chunks;
}


export class WormholeCore {
  constructor(options = {}) {
    if (!options.gun) {
      throw new Error('A gun instance must be provided via the "gun" option.');
    }
    this.gun = options.gun;
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onProgress = options.onProgress || (() => {});
  }

  async send({ file, filename, size, type, relayUrl, authToken }) {
    const code = generateCode();

    this.onStatusChange({
      code,
      status: 'uploading',
      message: `Caricamento di ${filename} sul relay IPFS...`
    });

    // 1. Upload file to IPFS via the relay server
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${relayUrl}/ipfs-upload`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${authToken}`
        },
        body: formData,
    });

    if (!response.ok) {
        const errorResult = await response.json().catch(() => ({ error: 'Upload failed with status ' + response.status }));
        throw new Error(errorResult.error || 'IPFS upload failed');
    }

    const result = await response.json();
    if (!result.success || !result.file?.hash) {
        throw new Error(result.error || 'Invalid response from IPFS upload endpoint');
    }
    
    const ipfsHash = result.file.hash;

    this.onStatusChange({
      code,
      status: 'pinning',
      message: `File aggiunto a IPFS. In attesa della conferma del pin...`
    });

    // 2. Save metadata (including the IPFS hash) to Gun
    const transferData = {
      filename: filename,
      size: size,
      type: type,
      ipfsHash: ipfsHash,
      createdAt: Date.now() // For the Garbage Collector
    };
    // Also add to a central index for the GC to find it
    this.gun.get('shogun-wormhole').get('wormhole-transfers').get(code).put({ createdAt: transferData.createdAt });
    
    // Store metadata under the generated code
    this.gun.get(code).put(transferData);
    
    this.onStatusChange({
      code,
      status: 'sent',
      message: 'File disponibile. Condividi il codice per iniziare il download.'
    });

    // Monitor for completion to unpin
    const completionHandler = async (data) => {
      if (data && data.status === 'completed') {
        this.gun.get(`${code}-received`).off(completionHandler);

        this.onStatusChange({
          code,
          status: 'completed',
          message: 'Trasferimento completato dal ricevente!'
        });

        try {
            this.onStatusChange({ code, status: 'unpinning', message: 'Tentativo di unpin da IPFS per pulizia...' });
            
            const unpinResponse = await fetch(`${relayUrl}/pins/rm`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({ cid: ipfsHash })
            });

            if (unpinResponse.ok) {
                 const unpinResult = await unpinResponse.json();
                 if (unpinResult.success) {
                    this.onStatusChange({ code, status: 'unpinned', message: 'File rimosso da IPFS con successo.' });
                 } else {
                    throw new Error(unpinResult.error || 'Unpin fallito sul relay.');
                 }
            } else {
                 throw new Error(`Il relay ha risposto con errore ${unpinResponse.status}`);
            }
        } catch(e) {
             console.error("Unpin failed:", e);
             this.onStatusChange({ code, status: 'info', message: 'Cleanup non riuscito, il file verrà rimosso dal GC del nodo IPFS.' });
        }
      }
    };
    this.gun.get(`${code}-received`).on(completionHandler);

    return code;
  }

  receive(code, relayUrl) {
    this.onStatusChange({ code, status: 'connecting', message: `Ricerca del trasferimento: ${code}` });

    const onceWithTimeout = (gunNode, timeout = 10000) => {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                gunNode.off(); // Clean up the listener
                reject(new Error(`Timeout: Nessun dato ricevuto per il codice "${code}" dopo ${timeout / 1000}s. Controlla il codice e riprova.`));
            }, timeout);

            gunNode.once(data => {
                clearTimeout(timer);
                resolve(data);
            });
        });
    };

    onceWithTimeout(this.gun.get(code))
      .then(async (metadata) => {
        if (!metadata || !metadata.ipfsHash) {
          this.onStatusChange({ code, status: 'error', message: 'Codice non valido o trasferimento non trovato.' });
        return;
      }

      this.onStatusChange({
        code,
          status: 'downloading',
          message: `Trovato: ${metadata.filename}. Download da IPFS in corso...`,
        metadata
      });

        // 3. Download file from IPFS Gateway
        try {
          const response = await fetch(`${relayUrl}/ipfs-content/${metadata.ipfsHash}`);
          if (!response.ok) {
            throw new Error(`Impossibile scaricare dal gateway IPFS (status: ${response.status})`);
          }
          
          const contentLength = response.headers.get('content-length');
          const total = parseInt(contentLength, 10);
          let loaded = 0;

          const onProgress = this.onProgress;

          const stream = new ReadableStream({
              start(controller) {
                  const reader = response.body.getReader();
                  function read() {
                      reader.read().then(({ done, value }) => {
                          if (done) {
                              controller.close();
                              return;
                          }
                          loaded += value.byteLength;
                          if (total) {
                              const progress = Math.round((loaded / total) * 100);
                              onProgress({ progress, loaded, total });
                          }
                          controller.enqueue(value);
                          read();
                      }).catch(error => {
                          console.error('Errore nello stream di lettura:', error);
                          controller.error(error);
                      });
                  }
                  read();
              }
          });
          
          const blob = await new Response(stream).blob();

                      this.onStatusChange({
                        code,
                        status: 'downloaded',
                        message: 'File scaricato con successo.',
                        fileData: {
                blob: blob,
                            filename: metadata.filename,
                            type: metadata.type
                        }
                      });

                      // Notify sender
                      this.gun.get(`${code}-received`).put({
                          status: 'completed',
                          timestamp: Date.now()
                      });

        } catch (error) {
            console.error("Errore di download:", error);
            this.onStatusChange({ code, status: 'error', message: error.message });
                  }
      })
      .catch(error => {
        this.onStatusChange({ code, status: 'error', message: error.message });
          });
  }
}

// Export utility functions for use in environment-specific code
export { generateCode }; 