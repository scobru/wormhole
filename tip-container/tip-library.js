/**
 * Libreria Tip Jar
 * Funzione per creare un contenitore con bottoni per mance (PayPal e Crypto).
 */
function createTipJar(options) {
    // --- Valori di default e configurazione ---
    const config = {
        // Obbligatori
        walletAddress: options.walletAddress || null,
        paypalUsername: options.paypalUsername || null,
        
        // Opzionali
        tipAmountEth: options.tipAmountEth || '0.01',
        containerId: options.containerId || null, // ID dell'elemento dove inserire i bottoni
        
        // Testi personalizzabili
        paypalText: options.paypalText || 'Leave a Tip with PayPal 💸',
        cryptoText: options.cryptoText || 'Leave a Tip with Crypto 🦊',
    };

    // Controlla che i parametri obbligatori siano stati forniti
    if (!config.walletAddress || !config.paypalUsername) {
        console.error("Errore Tip Jar: 'walletAddress' e 'paypalUsername' sono obbligatori.");
        return;
    }

    // --- Template HTML e CSS ---
    const jarHTML = `
        <style>
            .tip-jar-container-dynamic {
                display: flex;
                flex-direction: column;
                gap: 10px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
                max-width: 250px;
            }
            .tip-button-dynamic {
                padding: 12px 20px;
                border: none;
                border-radius: 8px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                text-decoration: none;
                color: white;
                text-align: center;
                transition: transform 0.2s ease-in-out;
            }
            .tip-button-dynamic:hover {
                transform: scale(1.05);
            }
            .tip-button-dynamic.paypal { background-color: #0070BA; }
            .tip-button-dynamic.crypto { background-color: #F6851B; }
        </style>

        <div class="tip-jar-container-dynamic">
            <a href="https://paypal.me/${config.paypalUsername}" target="_blank" rel="noopener noreferrer" class="tip-button-dynamic paypal">
                ${config.paypalText}
            </a>
            <button id="metamask-tip-button-dynamic" class="tip-button-dynamic crypto">
                ${config.cryptoText}
            </button>
        </div>
    `;

    // --- Inserimento nel DOM ---
    let container;
    if (config.containerId) {
        container = document.getElementById(config.containerId);
        if (!container) {
            console.error(`Errore Tip Jar: Elemento con ID "${config.containerId}" non trovato.`);
            return;
        }
    } else {
        container = document.createElement('div');
        document.body.appendChild(container);
    }
    container.innerHTML = jarHTML;

    // --- Logica JavaScript per Web3 tramite Shogun Core ---
    const metamaskButton = document.getElementById('metamask-tip-button-dynamic');

    metamaskButton.addEventListener('click', async () => {
        // Verifica che Shogun Core sia inizializzato
        if (!window.shogunCore) {
            console.error('Shogun Core non è inizializzato. Assicurati di chiamare initShogun prima di usare il tip jar.');
            alert('Errore: Shogun Core non è inizializzato.');
            return;
        }

        try {
            // Ottieni il plugin Web3
            const web3Plugin = window.shogunCore.getPlugin(CorePlugins.Web3);
            if (!web3Plugin) {
                alert('Il plugin Web3 non è disponibile. Assicurati che sia abilitato nella configurazione di Shogun Core.');
                return;
            }

            // Verifica la connessione e autentica se necessario
            if (!web3Plugin.isConnected()) {
                await web3Plugin.authenticate();
            }

            // Ottieni gli account disponibili
            const accounts = await web3Plugin.getAccounts();
            if (!accounts || accounts.length === 0) {
                throw new Error('Nessun account Web3 disponibile');
            }

            // Ottieni il provider Web3
            const provider = web3Plugin.getProvider();
            if (!provider) {
                throw new Error('Provider Web3 non disponibile');
            }

            // Verifica la rete
            const network = await provider.getNetwork();
            if (network.chainId !== 1) { // 1 = Ethereum Mainnet
                throw new Error('Per favore, passa alla rete Ethereum Mainnet per inviare la mancia');
            }

            // Converti l'importo in Wei
            const amountInWei = BigInt(parseFloat(config.tipAmountEth) * 1e18);
            const hexAmount = '0x' + amountInWei.toString(16);

            // Prepara i parametri della transazione
            const transactionParameters = {
                to: config.walletAddress,
                from: accounts[0],
                value: hexAmount,
                chainId: network.chainId
            };

            try {
                // Stima il gas
                const gasEstimate = await provider.estimateGas(transactionParameters);
                transactionParameters.gasLimit = gasEstimate;
            } catch (error) {
                console.warn('Errore nella stima del gas:', error);
                // Procedi comunque, lascia che il wallet gestisca il gas
            }

            // Invia la transazione
            const tx = await web3Plugin.sendTransaction(transactionParameters);
            
            // Attendi la conferma
            const receipt = await tx.wait();
            
            alert(`Grazie mille per la tua mancia!\nHash della transazione: ${receipt.transactionHash}`);
        } catch (error) {
            console.error('Errore durante la transazione:', error);
            alert(`Qualcosa è andato storto: ${error.message}`);
        }
    });
}