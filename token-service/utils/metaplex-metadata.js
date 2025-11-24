const { PublicKey, Keypair } = require('@solana/web3.js');
const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const { createV1, TokenStandard } = require('@metaplex-foundation/mpl-token-metadata');
const {
  createSignerFromKeypair,
  signerIdentity,
  percentAmount,
  none,
  publicKey,
  transactionBuilder,
} = require('@metaplex-foundation/umi');
const {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
  toWeb3JsLegacyTransaction,
} = require('@metaplex-foundation/umi-web3js-adapters');

const TOKEN_2022_PROGRAM_ID = publicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

/**
 * Симулирует транзакцию и возвращает результаты симуляции
 * Общая функция для устранения дублирования кода
 */
async function simulateTransaction(transaction, rpcUrl, label = 'simulation') {
  const { Connection, Transaction: SolanaTransaction } = require('@solana/web3.js');
  const connection = new Connection(rpcUrl, 'confirmed');
  
  const simulationTx = SolanaTransaction.from(transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }));
  
  const simulation = await connection.simulateTransaction(simulationTx, {
    replaceRecentBlockhash: true,
    sigVerify: false,
  });
  
  if (!simulation || !simulation.value) {
    return null;
  }
  
  const fee = simulation.value.fee || 0;
  
  // Находим rent (самое большое положительное изменение баланса)
  let rent = 0;
  if (simulation.value.accounts) {
    simulation.value.accounts.forEach((acc) => {
      if (acc) {
        const preBalance = acc.preLamports || 0;
        const postBalance = acc.postLamports || 0;
        const change = postBalance - preBalance;
        if (change > 1000000) { // Больше 0.001 SOL - это скорее всего rent
          rent = Math.max(rent, change);
        }
      }
    });
  }
  
  return {
    fee,
    rent,
    total: rent + fee,
    simulation: simulation.value,
  };
}

/**
 * Симулирует транзакцию метадаты для получения точной стоимости
 * Использует РЕАЛЬНЫЕ данные (name, symbol, uri) для точного расчета
 */
async function estimateMetadataCost({
  payerAddress,
  name,
  symbol,
  uri,
  rpcUrl = 'https://api.devnet.solana.com',
}) {
  try {
    console.log('[estimateMetadataCost] Estimating metadata transaction cost...');
    
    const umi = createUmi(rpcUrl);
    const payer = publicKey(payerAddress);
    const payerWeb3Js = new PublicKey(payerAddress);
    
    // Создаем временный mint для симуляции (не используется в реальной транзакции)
    const tempMint = Keypair.generate();
    const mint = tempMint.publicKey;
    
    // Используем РЕАЛЬНЫЕ данные для точного расчета стоимости
    // Если данные не переданы, используем пустые строки (минимальный размер)
    const actualName = sanitizeString(name || '');
    const actualSymbol = sanitizeString(symbol || '');
    const actualUri = sanitizeString(uri || '');
    
    console.log('[estimateMetadataCost] Using REAL data for cost estimation:');
    console.log(`[estimateMetadataCost]   - Name: "${actualName}" (${Buffer.from(actualName, 'utf8').length} bytes)`);
    console.log(`[estimateMetadataCost]   - Symbol: "${actualSymbol}" (${Buffer.from(actualSymbol, 'utf8').length} bytes)`);
    console.log(`[estimateMetadataCost]   - URI: "${actualUri.substring(0, 50)}${actualUri.length > 50 ? '...' : ''}" (${Buffer.from(actualUri, 'utf8').length} bytes)`);
    
    const onChainData = {
      name: actualName,
      symbol: actualSymbol,
      uri: actualUri,
      sellerFeeBasisPoints: percentAmount(0, 2),
      creators: none(),
      collection: none(),
      uses: none(),
    };
    
    const dummySigner = {
      publicKey: payer,
      signMessage: async () => { throw new Error('Should not be called'); },
      signTransaction: async () => { throw new Error('Should not be called'); },
      signAllTransactions: async () => { throw new Error('Should not be called'); },
    };
    umi.use(signerIdentity(dummySigner));
    
    const accounts = {
      mint,
      splTokenProgram: TOKEN_2022_PROGRAM_ID,
      updateAuthority: payer,
    };
    
    const data = {
      ...onChainData,
      isMutable: true,
      discriminator: 0,
      tokenStandard: TokenStandard.Fungible,
      collectionDetails: none(),
      ruleSet: none(),
      createV1Discriminator: 0,
      primarySaleHappened: true,
      decimals: none(),
      printSupply: none(),
    };
    
    const builder = createV1(umi, { 
      ...accounts, 
      ...data,
      payer,
    });
    
    const builderWithBlockhash = await builder.setLatestBlockhash(umi);
    const transaction = await builderWithBlockhash.build(umi);
    const web3LegacyTransaction = toWeb3JsLegacyTransaction(transaction);
    web3LegacyTransaction.feePayer = payerWeb3Js;
    web3LegacyTransaction.signatures = [];
    
    // Симулируем транзакцию используя общую функцию
    const simResult = await simulateTransaction(web3LegacyTransaction, rpcUrl, 'estimateMetadataCost');
    
    if (simResult) {
      console.log(`[estimateMetadataCost] Estimated metadata cost (using REAL data):`);
      console.log(`[estimateMetadataCost]   - Rent: ${simResult.rent} lamports (${simResult.rent / 1_000_000_000} SOL)`);
      console.log(`[estimateMetadataCost]   - Fee: ${simResult.fee} lamports (${simResult.fee / 1_000_000_000} SOL)`);
      console.log(`[estimateMetadataCost]   - Total: ${simResult.total} lamports (${simResult.total / 1_000_000_000} SOL)`);
      
      return {
        rentLamports: simResult.rent,
        feeLamports: simResult.fee,
        totalLamports: simResult.total,
      };
    }
    
    // Fallback на константы если симуляция не удалась
    console.warn('[estimateMetadataCost] Simulation failed, using fallback constants');
    return {
      rentLamports: 13_000_000,
      feeLamports: 5_000,
      totalLamports: 13_005_000,
    };
  } catch (error) {
    console.error('[estimateMetadataCost] Error estimating cost:', error);
    // Fallback на константы при ошибке
    return {
      rentLamports: 13_000_000,
      feeLamports: 5_000,
      totalLamports: 13_005_000,
    };
  }
}

function sanitizeString(str) {
  if (!str || typeof str !== 'string') {
    return '';
  }
  
  // Удаляем null байты и другие недопустимые символы
  // Сохраняем пробелы, переносы строк и табуляции, но удаляем другие управляющие символы
  return str
    .replace(/\0/g, '')  // Удаляем null байты
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '')  // Удаляем управляющие символы (кроме \t, \n, \r)
    .trim();  // Убираем пробелы по краям
}

async function addMetaplexMetadata({
  mintAddress,
  mintSecretKey,  // Array of numbers from mint keypair
  payerAddress,   // string
  name,
  symbol,
  uri,
  rpcUrl = 'https://api.devnet.solana.com',
}) {
  console.log('[addMetaplexMetadata] Starting metadata creation');
  console.log('[addMetaplexMetadata] Mint:', mintAddress);
  console.log('[addMetaplexMetadata] Name:', name);
  console.log('[addMetaplexMetadata] Symbol:', symbol);
  console.log('[addMetaplexMetadata] URI:', uri);
  console.log('[addMetaplexMetadata] Payer:', payerAddress);

  const umi = createUmi(rpcUrl);
  
  const mint = publicKey(mintAddress);
  const payer = publicKey(payerAddress);
  
  // Create Web3.js PublicKey for feePayer (needed for Transaction.feePayer)
  const payerWeb3Js = new PublicKey(payerAddress);
  
  // CRITICAL: Payer is the mint authority (set in createBaseToken2022, line 85)
  // Payer is also the update authority for Metaplex metadata
  // We don't need mint keypair for Metaplex - only payer needs to sign on frontend
  
  const sanitizedName = sanitizeString(name);
  const sanitizedSymbol = sanitizeString(symbol);
  const sanitizedUri = sanitizeString(uri || '');
  
  console.log('[addMetaplexMetadata] Sanitized - Name:', sanitizedName);
  console.log('[addMetaplexMetadata] Sanitized - Symbol:', sanitizedSymbol);
  console.log('[addMetaplexMetadata] Sanitized - URI:', sanitizedUri);
  
  const onChainData = {
    name: sanitizedName,
    symbol: sanitizedSymbol,
    uri: sanitizedUri,
    sellerFeeBasisPoints: percentAmount(0, 2),
    creators: none(),
    collection: none(),
    uses: none(),
  };
  
  console.log('[addMetaplexMetadata] On-chain data prepared');
  
  // Step 6: Create a dummy signer for UMI context (UMI needs identity, but payer will sign on frontend)
  // We can't create real payer signer without private key, so create a no-op signer
  const dummySigner = {
    publicKey: payer,
    signMessage: async () => { throw new Error('Should not be called'); },
    signTransaction: async () => { throw new Error('Should not be called'); },
    signAllTransactions: async () => { throw new Error('Should not be called'); },
  };
  umi.use(signerIdentity(dummySigner));
  
  const accounts = {
    mint,
    splTokenProgram: TOKEN_2022_PROGRAM_ID,
    updateAuthority: payer,  // CRITICAL: Payer is the mint authority (set in createBaseToken2022)
  };
  
  const data = {
    ...onChainData,
    isMutable: true,
    discriminator: 0,
    tokenStandard: TokenStandard.Fungible,
    collectionDetails: none(),
    ruleSet: none(),
    createV1Discriminator: 0,
    primarySaleHappened: true,
    decimals: none(),
    printSupply: none(),
  };
  
  console.log('[addMetaplexMetadata] Building Metaplex transaction');
  
  try {
    const builder = createV1(umi, { 
      ...accounts, 
      ...data,
      payer,  // payer will sign on frontend
    });
    
    const builderWithBlockhash = await builder.setLatestBlockhash(umi);
    
    // Build transaction from builder
    const transaction = await builderWithBlockhash.build(umi);
    
    // Convert UMI transaction to Web3.js legacy transaction (for frontend compatibility)
    const web3LegacyTransaction = toWeb3JsLegacyTransaction(transaction);
    
    console.log('[addMetaplexMetadata] Converted to legacy transaction');
    console.log('[addMetaplexMetadata] Instructions count:', web3LegacyTransaction.instructions.length);
    
    // Детальный анализ инструкций - ищем именно TRANSFER, а не все SystemProgram инструкции
    console.log('[addMetaplexMetadata] Detailed instruction analysis:');
    let hasRealTransfer = false;
    let totalLamportsTransferred = 0;
    
    web3LegacyTransaction.instructions.forEach((ix, idx) => {
      const programId = ix.programId?.toString() || 'unknown';
      const isSystemProgram = programId === '11111111111111111111111111111111';
      
      if (isSystemProgram) {
        // SystemProgram transfer имеет discriminator = 2 и data длиной 12 байт (4 + 8 для lamports)
        // SystemProgram createAccount имеет discriminator = 0 и другую структуру
        const dataLength = ix.data?.length || 0;
        
        if (dataLength > 0) {
          const discriminator = ix.data[0];
          
          // Discriminator 2 = Transfer
          // Discriminator 0 = CreateAccount
          // Discriminator 1 = Assign
          // Discriminator 3 = CreateAccountWithSeed
          if (discriminator === 2 && dataLength >= 12) {
            // Это TRANSFER инструкция - извлекаем количество lamports
            const lamports = ix.data.readBigUInt64LE(4);
            totalLamportsTransferred += Number(lamports);
            hasRealTransfer = true;
            console.warn(`[addMetaplexMetadata] WARNING: Found SystemProgram TRANSFER at instruction ${idx}! Amount: ${lamports} lamports (${Number(lamports) / 1_000_000_000} SOL)`);
          } else {
            console.log(`[addMetaplexMetadata] Instruction ${idx}: SystemProgram (discriminator=${discriminator}, length=${dataLength}) - createAccount/assign, NOT transfer`);
          }
        } else {
          console.log(`[addMetaplexMetadata] Instruction ${idx}: SystemProgram (no data)`);
        }
      } else {
        const programShort = programId.length > 16 ? programId.substring(0, 16) + '...' : programId;
        console.log(`[addMetaplexMetadata] Instruction ${idx}: Program ${programShort}`);
      }
    });
    
    if (hasRealTransfer) {
      console.error(`[addMetaplexMetadata] CRITICAL: Found actual TRANSFER instruction! Total: ${totalLamportsTransferred} lamports (${totalLamportsTransferred / 1_000_000_000} SOL)`);
      console.error('[addMetaplexMetadata] Fixed charge should NOT be in metadata transaction! This is a bug!');
    } else {
      console.log('[addMetaplexMetadata] OK: No TRANSFER instructions found (only createAccount/assign for rent exemption)');
    }
    
    console.log('[addMetaplexMetadata] Signatures before cleanup:', web3LegacyTransaction.signatures.length);
    console.log('[addMetaplexMetadata] Fee payer before fix:', web3LegacyTransaction.feePayer?.toBase58());
    
    // Validate transaction before signing
    if (!web3LegacyTransaction.instructions || web3LegacyTransaction.instructions.length === 0) {
      throw new Error('Transaction has no instructions after conversion');
    }
    
    if (!web3LegacyTransaction.recentBlockhash) {
      throw new Error('Transaction missing recentBlockhash');
    }
    
    // CRITICAL FIX: Set payer as feePayer (UMI may set wrong feePayer by default)
    web3LegacyTransaction.feePayer = payerWeb3Js;
    console.log('[addMetaplexMetadata] Fee payer set to:', payerWeb3Js.toBase58());
    
    // IMPORTANT: Don't sign with mint keypair - payer is the mint authority!
    // Clear any signatures from UMI (if any) and leave transaction unsigned
    // Payer will sign on frontend as both fee payer and mint authority
    web3LegacyTransaction.signatures = [];
    
    console.log('[addMetaplexMetadata] Transaction left unsigned (payer will sign on frontend)');
    console.log('[addMetaplexMetadata] Signatures count:', web3LegacyTransaction.signatures.length);
    console.log('[addMetaplexMetadata] Fee payer:', web3LegacyTransaction.feePayer?.toBase58() || 'undefined');
    console.log('[addMetaplexMetadata] Recent blockhash:', web3LegacyTransaction.recentBlockhash);

    // Симуляция транзакции для валидации (используем общую функцию)
    try {
      console.log('[addMetaplexMetadata] 🔍 Simulating transaction (as Solflare does before showing to user)...');
      const simResult = await simulateTransaction(web3LegacyTransaction, rpcUrl, 'addMetaplexMetadata');
      
      if (simResult && simResult.simulation) {
        console.log('[addMetaplexMetadata] === SIMULATION RESULT (what Solflare sees) ===');
        console.log('[addMetaplexMetadata] Units consumed:', simResult.simulation.unitsConsumed);
        console.log('[addMetaplexMetadata] Network fee:', simResult.fee, 'lamports =', simResult.fee / 1_000_000_000, 'SOL');
        
        // Анализ изменения балансов
        if (simResult.simulation.accounts) {
          let totalBalanceChange = 0;
          console.log('[addMetaplexMetadata] Account balance changes:');
          simResult.simulation.accounts.forEach((acc, idx) => {
            if (acc) {
              const preBalance = acc.preLamports || 0;
              const postBalance = acc.postLamports || 0;
              const change = postBalance - preBalance;
              
              if (Math.abs(change) > 100) { // Логируем изменения больше 100 lamports
                const changeSol = change / 1_000_000_000;
                console.log(`[addMetaplexMetadata]   Account ${idx}: ${change} lamports (${changeSol > 0 ? '+' : ''}${changeSol} SOL)`);
                totalBalanceChange += change;
              }
            }
          });
          
          const totalChangeSol = Math.abs(totalBalanceChange) / 1_000_000_000;
          console.log(`[addMetaplexMetadata] 💰 TOTAL USER PAYMENT: ${Math.abs(totalBalanceChange)} lamports = ${totalChangeSol} SOL`);
          console.log(`[addMetaplexMetadata] ⚠️  This is what Solflare will show to user for SECOND transaction!`);
          
          // Вторая транзакция должна содержать только rent для метаданных + комиссия
          // Rent для метаданных Metaplex обычно ~0.013 SOL (13,000,000 lamports), комиссия ~0.000005 SOL
          // Это дороже, чем обычные аккаунты, потому что метаданные аккаунт большой
          const expectedMin = 0.01; // Минимум ~0.01 SOL (rent для метаданных)
          const expectedMax = 0.02; // Максимум ~0.02 SOL (rent + комиссия + небольшие вариации)
          
          const metadataRent = simResult.rent;
          
          console.log(`[addMetaplexMetadata] Expected breakdown for second transaction:`);
          console.log(`[addMetaplexMetadata]   - Rent for metadata account: ${metadataRent} lamports (${metadataRent / 1_000_000_000} SOL)`);
          console.log(`[addMetaplexMetadata]   - Network fee: ${simResult.fee} lamports (${simResult.fee / 1_000_000_000} SOL)`);
          console.log(`[addMetaplexMetadata]   - Expected range: ${expectedMin}-${expectedMax} SOL`);
          console.log(`[addMetaplexMetadata]   - Should NOT include fixed_charge!`);
          
          if (totalChangeSol > expectedMax) {
            console.error(`[addMetaplexMetadata] 🚨 CRITICAL: Total change (${totalChangeSol} SOL) exceeds expected maximum (${expectedMax} SOL)!`);
            console.error(`[addMetaplexMetadata] This suggests there might be an unexpected transfer or very large rent exemption!`);
            console.error(`[addMetaplexMetadata] Difference: ${(totalChangeSol - expectedMax) * 1_000_000_000} lamports (${totalChangeSol - expectedMax} SOL)`);
          } else if (totalChangeSol < expectedMin) {
            console.warn(`[addMetaplexMetadata] ⚠️  WARNING: Total change (${totalChangeSol} SOL) is lower than expected minimum (${expectedMin} SOL)!`);
            console.warn(`[addMetaplexMetadata] This might indicate that rent was already paid or account exists.`);
          } else {
            console.log(`[addMetaplexMetadata] ✅ OK: Total change (${totalChangeSol} SOL) is within expected range (rent ~${metadataRent / 1_000_000_000} SOL + fee ${simResult.fee / 1_000_000_000} SOL)`);
          }
          
          // Сохраняем реальную стоимость для возможного использования
          console.log(`[addMetaplexMetadata] 📊 REAL cost breakdown: rent=${metadataRent / 1_000_000_000} SOL, fee=${simResult.fee / 1_000_000_000} SOL, total=${totalChangeSol} SOL`);
        }
      }
    } catch (simError) {
      console.warn('[addMetaplexMetadata] Simulation failed (non-critical):', simError.message);
    }
 
    const serialized = web3LegacyTransaction.serialize({
      requireAllSignatures: false, // payer will sign on frontend
      verifySignatures: false,
    });
    
    if (!serialized || serialized.length === 0) {
      throw new Error('Transaction serialization returned empty buffer');
    }
    
    const base64Transaction = Buffer.from(serialized).toString('base64');
    
    if (!base64Transaction || base64Transaction.length === 0) {
      throw new Error('Base64 encoding returned empty string');
    }
    
    console.log('[addMetaplexMetadata] Transaction built, returning for frontend signing');
    console.log('[addMetaplexMetadata] Transaction size:', serialized.length, 'bytes');
    console.log('[addMetaplexMetadata] Base64 length:', base64Transaction.length);
    console.log('[addMetaplexMetadata] Base64 preview:', base64Transaction.substring(0, 50) + '...');
    
    return {
      success: true,
      transaction: base64Transaction,
      message: 'Transaction ready for signing'
    };
  } catch (error) {
    console.error('[addMetaplexMetadata] Error:', error);
    console.error('[addMetaplexMetadata] Error stack:', error.stack);
    throw error;
  }
}

module.exports = { addMetaplexMetadata, estimateMetadataCost };

