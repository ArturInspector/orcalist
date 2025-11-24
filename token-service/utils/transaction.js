const { Connection, Transaction } = require('@solana/web3.js');

/**
 * Sends a signed transaction to Solana RPC
 * @param {Object} params
 * @param {string} params.signedTransaction - Base64 encoded signed transaction
 * @param {string} params.rpcUrl - RPC URL
 * @returns {Promise<Object>} Transaction signature and confirmation
 */
async function sendSignedTransaction({ signedTransaction, rpcUrl = 'https://api.devnet.solana.com' }) {
  try {
    console.log('Sending transaction to RPC:', rpcUrl);
    
    const connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });
    
    // Deserialize transaction from base64
    const transactionBuffer = Buffer.from(signedTransaction, 'base64');
    const transaction = Transaction.from(transactionBuffer);
    
    console.log('Transaction deserialized, sending to RPC...');
    
    // Send transaction with retry logic for expired blockhash
    let signature;
    let retries = 2;
    while (retries >= 0) {
      try {
        signature = await connection.sendRawTransaction(transaction.serialize(), {
          skipPreflight: false,
          maxRetries: 3,
        });
        break; // Success, exit loop
      } catch (error) {
        const errorMessage = error?.message || String(error);
        const isBlockhashError = /blockhash not found|Blockhash not found|Transaction expired/i.test(errorMessage);
        
        if (isBlockhashError && retries > 0) {
          console.warn(`Blockhash expired, retrying... (${retries} attempts left)`);
          retries--;
          // Wait a bit before retry
          await new Promise(resolve => setTimeout(resolve, 1000));
          // Note: We can't update blockhash here because transaction is already signed
          // The frontend should handle blockhash refresh before signing
          continue;
        }
        throw error; // Re-throw if not blockhash error or out of retries
      }
    }
    
    console.log('Transaction sent, signature:', signature);
    
    // Wait for confirmation
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    console.log('Transaction confirmed:', confirmation);
    
    return {
      signature,
      confirmation,
    };
  } catch (error) {
    console.error('Error in sendSignedTransaction:', error);
    throw error;
  }
}

/**
 * Creates token transaction (legacy function, kept for backward compatibility)
 * This function is not used in the new flow, but kept to avoid breaking changes
 */
async function createTokenTransaction(params) {
  throw new Error('createTokenTransaction is deprecated. Use createBaseToken2022 instead.');
}

module.exports = {
  sendSignedTransaction,
  createTokenTransaction,
};

