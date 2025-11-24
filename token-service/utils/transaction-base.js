const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} = require('@solana/web3.js');
const {
  TOKEN_2022_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
} = require('@solana/spl-token');

async function createBaseToken2022({
  wallet,
  decimals = 9,
  priorityFee = 250000,
  rpcUrl = 'https://api.devnet.solana.com',
  chargeTo = null,
  fixedChargeSol = 0,
  name = '',
  symbol = '',
  uri = '',
}) {
  console.log('[createBaseToken2022] Starting base token creation');
  console.log('[createBaseToken2022] Wallet:', wallet);
  console.log('[createBaseToken2022] Decimals:', decimals);
  console.log('[createBaseToken2022] Priority Fee:', priorityFee);
  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000, // 60 seconds
  });
  const payer = new PublicKey(wallet);
  
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  
  console.log('[createBaseToken2022] Generated mint:', mint.toBase58());
  
  const mintLen = MINT_SIZE; // 82 bytes
  console.log('[createBaseToken2022] Mint size (no extensions):', mintLen);
  
  // Retry logic for RPC calls
  let lamports;
  let retries = 3;
  while (retries > 0) {
    try {
      lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
      break;
    } catch (error) {
      retries--;
      if (retries === 0) {
        console.error('[createBaseToken2022] RPC call failed after retries:', error);
        throw new Error(`RPC connection failed: ${error.message}`);
      }
      console.warn(`[createBaseToken2022] RPC call failed, retrying... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
    }
  }
  console.log('[createBaseToken2022] Required lamports:', lamports);
  
  const transaction = new Transaction();
  
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: priorityFee,
  });
  transaction.add(priorityFeeIx);
  console.log('[createBaseToken2022] Added ComputeBudget instruction');
  
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: mint,
    space: mintLen,
    lamports: lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  });
  transaction.add(createAccountIx);
  console.log('[createBaseToken2022] Added CreateAccount instruction');
  
  // mint
  const initMintIx = createInitializeMintInstruction(
    mint,
    decimals,
    payer,  // mint authority (revoke later)
    payer,  // freeze authority
    TOKEN_2022_PROGRAM_ID
  );
  transaction.add(initMintIx);
  console.log('[createBaseToken2022] Added InitializeMint instruction');
  
  // fixed charge (if specified)
  // subtract the cost of the second transaction (metadata) from fixed_charge
  // use simulation to get the exact cost of metadata with REAL data
  let SECOND_TX_TOTAL_LAMPORTS = 13_005_000; // fallback value
  if (chargeTo && fixedChargeSol > 0) {
    try {
      // simulate the metadata transaction predicting
      const { estimateMetadataCost } = require('./metaplex-metadata');
      const metadataCost = await estimateMetadataCost({
        payerAddress: wallet,
        name: name || '',
        symbol: symbol || '',
        uri: uri || '',
        rpcUrl: rpcUrl,
      });
      SECOND_TX_TOTAL_LAMPORTS = metadataCost.totalLamports;
      console.log(`[createBaseToken2022] Estimated metadata cost via simulation (using REAL data): ${SECOND_TX_TOTAL_LAMPORTS} lamports (${SECOND_TX_TOTAL_LAMPORTS / 1_000_000_000} SOL)`);
    } catch (error) {
      console.warn('[createBaseToken2022] Failed to estimate metadata cost, using fallback:', error.message);
      // use fallback values
      SECOND_TX_TOTAL_LAMPORTS = 13_005_000;
    }
  }
  
  let adjustedChargeLamports = 0; // declare outside the block for use in simulation
  if (chargeTo && fixedChargeSol > 0) {
    try {
      const chargeToPubkey = new PublicKey(chargeTo);
      const fixedChargeLamports = Math.floor(fixedChargeSol * 1_000_000_000);
      // Вычитаем полную стоимость второй транзакции (rent + комиссия)
      adjustedChargeLamports = Math.max(0, fixedChargeLamports - SECOND_TX_TOTAL_LAMPORTS);
      
      if (adjustedChargeLamports > 0) {
        const transferIx = SystemProgram.transfer({
          fromPubkey: payer,
          toPubkey: chargeToPubkey,
          lamports: adjustedChargeLamports,
        });
        transaction.add(transferIx);
        const adjustedChargeSol = adjustedChargeLamports / 1_000_000_000;
        const subtractedTotalSol = SECOND_TX_TOTAL_LAMPORTS / 1_000_000_000;
        console.log(`[createBaseToken2022] Added fixed charge transfer: ${adjustedChargeLamports} lamports = ${adjustedChargeSol} SOL`);
        console.log(`[createBaseToken2022] Original fixed_charge: ${fixedChargeSol} SOL`);
        console.log(`[createBaseToken2022] Subtracted second tx costs: ${SECOND_TX_TOTAL_LAMPORTS} lamports (${subtractedTotalSol} SOL)`);
        console.log(`[createBaseToken2022] REMEMBER: Fixed charge is ONLY in first transaction, NOT in metadata transaction!`);
      } else {
        console.log('[createBaseToken2022] Fixed charge too small after subtracting second tx fee, skipping');
      }
    } catch (error) {
      console.error('[createBaseToken2022] Invalid chargeTo address:', error);
      // continue without fixed_charge, don't fail
    }
  }
  
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = payer;
  
  console.log('[createBaseToken2022] Transaction blockhash:', blockhash);
  console.log('[createBaseToken2022] Transaction feePayer:', payer.toBase58());
  
  // simulation of the transaction to check the real costs (as Solflare does)
  try {
    console.log('[createBaseToken2022] 🔍 Simulating transaction (as Solflare does before showing to user)...');
    const simulation = await connection.simulateTransaction(transaction, {
      replaceRecentBlockhash: true,
      sigVerify: false,
    });
    
    if (simulation && simulation.value) {
      console.log('[createBaseToken2022] === SIMULATION RESULT (what Solflare sees) ===');
      console.log('[createBaseToken2022] Units consumed:', simulation.value.unitsConsumed);
      const fee = simulation.value.fee || 0;
      console.log('[createBaseToken2022] Network fee:', fee, 'lamports =', fee / 1_000_000_000, 'SOL');
      
      if (simulation.value.accounts) {
        let totalBalanceChange = 0;
        console.log('[createBaseToken2022] Account balance changes:');
        simulation.value.accounts.forEach((acc, idx) => {
          if (acc) {
            const preBalance = acc.preLamports || 0;
            const postBalance = acc.postLamports || 0;
            const change = postBalance - preBalance;
            
            if (Math.abs(change) > 100) { // log changes more than 100 lamports
              const changeSol = change / 1_000_000_000;
              console.log(`[createBaseToken2022]   Account ${idx}: ${change} lamports (${changeSol > 0 ? '+' : ''}${changeSol} SOL)`);
              totalBalanceChange += change;
            }
          }
        });
        
        const totalChangeSol = Math.abs(totalBalanceChange) / 1_000_000_000;
        console.log(`[createBaseToken2022] 💰 TOTAL USER PAYMENT: ${Math.abs(totalBalanceChange)} lamports = ${totalChangeSol} SOL`);
        console.log(`[createBaseToken2022] ⚠️  This is what Solflare will show to user for FIRST transaction!`);
        
        // check the expected costs
        const expectedFixedCharge = adjustedChargeLamports;
        const rentForMint = lamports;
        const expectedTotal = expectedFixedCharge + rentForMint + fee;
        
        console.log(`[createBaseToken2022] Expected breakdown:`);
        console.log(`[createBaseToken2022]   - Fixed charge: ${expectedFixedCharge} lamports (${expectedFixedCharge / 1_000_000_000} SOL)`);
        console.log(`[createBaseToken2022]   - Rent for mint: ${rentForMint} lamports (${rentForMint / 1_000_000_000} SOL)`);
        console.log(`[createBaseToken2022]   - Network fee: ${fee} lamports (${fee / 1_000_000_000} SOL)`);
        console.log(`[createBaseToken2022]   - Expected total: ${expectedTotal} lamports (${expectedTotal / 1_000_000_000} SOL)`);
        
        const diff = Math.abs(Math.abs(totalBalanceChange) - expectedTotal);
        if (diff > 10000) {
          console.warn(`[createBaseToken2022] ⚠️  WARNING: Simulation total (${totalChangeSol} SOL) differs from expected (${expectedTotal / 1_000_000_000} SOL) by ${diff} lamports!`);
        } else {
          console.log(`[createBaseToken2022] ✅ OK: Simulation matches expected costs`);
        }
      }
    }
  } catch (simError) {
    console.warn('[createBaseToken2022] Simulation failed (non-critical):', simError.message);
  }
  
  // mint keypair signs the transaction
  transaction.partialSign(mintKeypair);
  console.log('[createBaseToken2022] Mint keypair signed transaction');
  
  const serializedTx = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  
  console.log('[createBaseToken2022] Transaction serialized, size:', serializedTx.length);
  console.log('[createBaseToken2022] Base token transaction ready');
  
  return {
    transaction: serializedTx.toString('base64'),
    mint: mint.toBase58(),
    mintSecretKey: Array.from(mintKeypair.secretKey),
  };
}

module.exports = { createBaseToken2022 };

