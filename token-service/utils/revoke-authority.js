const {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  SystemProgram,
} = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  createSetAuthorityInstruction,
  AuthorityType,
  getMint,
} = require('@solana/spl-token');

/**
 * Creates revoke authority transactions for Token-2022
 * 
 * @param {Object} params
 * @param {string} params.wallet - Wallet address (payer and current authority)
 * @param {string} params.mintAddress - Mint address
 * @param {boolean} params.revokeMint - Revoke mint authority
 * @param {boolean} params.revokeFreeze - Revoke freeze authority
 * @param {number} params.priorityFee - Priority fee in microLamports
 * @param {string} params.rpcUrl - RPC URL
 * @param {string|null} params.chargeTo - Address to charge revoke fee (optional)
 * 
 * @returns {Promise<Object>} { success: boolean, transactions: string[], message?: string }
 */
const REVOKE_CHARGE_SOL = parseFloat(process.env.REVOKE_CHARGE_SOL || '0.0999');

async function createRevokeTransactions({
  wallet,
  mintAddress,
  revokeMint = false,
  revokeFreeze = false,
  priorityFee = 250000,
  rpcUrl = 'https://api.devnet.solana.com',
  chargeTo = null,
}) {
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const payer = new PublicKey(wallet);
    const mint = new PublicKey(mintAddress);
    
    console.log(`[revoke-authority] Creating revoke transactions:`, {
      wallet,
      mint: mintAddress,
      revokeMint,
      revokeFreeze,
    });
    const mintInfo = await getMint(connection, mint, undefined, TOKEN_2022_PROGRAM_ID);
    
    console.log(`[revoke-authority] Mint info:`, {
      mintAuthority: mintInfo.mintAuthority?.toBase58() || 'None',
      freezeAuthority: mintInfo.freezeAuthority?.toBase58() || 'None',
    });
    
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }));
    
    let instructionsAdded = 0;
    
    if (revokeMint) {
      if (!mintInfo.mintAuthority) {
        console.log('[revoke-authority] Mint authority already revoked');
      } else if (mintInfo.mintAuthority.equals(payer)) {
        tx.add(createSetAuthorityInstruction(
          mint,                    // account
          payer,                   // currentAuthority
          AuthorityType.MintTokens, // authorityType
          null,                    // newAuthority (null = revoke)
          [],                      // multiSigners
          TOKEN_2022_PROGRAM_ID    // programId
        ));
        instructionsAdded++;
        console.log('[revoke-authority] Added revoke mint authority instruction');
      } else {
        throw new Error(`Wallet is not mint authority. Current: ${mintInfo.mintAuthority.toBase58()}`);
      }
    }
    
    // Revoke freeze authority
    if (revokeFreeze) {
      if (!mintInfo.freezeAuthority) {
        console.log('[revoke-authority] Freeze authority already revoked');
      } else if (mintInfo.freezeAuthority.equals(payer)) {
        tx.add(createSetAuthorityInstruction(
          mint,                      // account
          payer,                     // currentAuthority
          AuthorityType.FreezeAccount, // authorityType
          null,                      // newAuthority (null = revoke)
          [],                        // multiSigners
          TOKEN_2022_PROGRAM_ID      // programId
        ));
        instructionsAdded++;
        console.log('[revoke-authority] Added revoke freeze authority instruction');
      } else {
        throw new Error(`Wallet is not freeze authority. Current: ${mintInfo.freezeAuthority.toBase58()}`);
      }
    }
    
    if (instructionsAdded === 0) {
      return {
        success: true,
        transactions: [],
        message: 'All requested authorities are already revoked',
      };
    }
    if (chargeTo && instructionsAdded > 0) {
      const chargeToPubkey = new PublicKey(chargeTo);
      const revokeChargeLamports = Math.floor(instructionsAdded * REVOKE_CHARGE_SOL * 1_000_000_000);
      const chargeSol = (instructionsAdded * REVOKE_CHARGE_SOL).toFixed(4);
      tx.add(SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: chargeToPubkey,
        lamports: revokeChargeLamports,
      }));
      console.log(`[revoke-authority] Added charge transfer: ${revokeChargeLamports} lamports (${instructionsAdded} revokes * ${REVOKE_CHARGE_SOL} SOL = ${chargeSol} SOL) to ${chargeTo}`);
    }
    
    // Get blockhash and set fee payer
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;
    
    // Serialize transaction
    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    
    console.log(`[revoke-authority] Created transaction with ${tx.instructions.length} instructions (${instructionsAdded} revoke + ${chargeTo ? 1 : 0} transfer + 1 priority)`);
    
    return {
      success: true,
      transactions: [Buffer.from(serialized).toString('base64')],
    };
  } catch (error) {
    console.error('[revoke-authority] Error:', error);
    throw error;
  }
}

module.exports = { createRevokeTransactions };

