const { PublicKey, Keypair } = require('@solana/web3.js');
const { createUmi } = require('@metaplex-foundation/umi-bundle-defaults');
const { createV1, updateV1, findMetadataPda, TokenStandard } = require('@metaplex-foundation/mpl-token-metadata');
const {
  createSignerFromKeypair,
  signerIdentity,
  percentAmount,
  none,
  some,
  publicKey,
  transactionBuilder,
} = require('@metaplex-foundation/umi');
const {
  fromWeb3JsKeypair,
  fromWeb3JsPublicKey,
  toWeb3JsLegacyTransaction,
} = require('@metaplex-foundation/umi-web3js-adapters');

const TOKEN_2022_PROGRAM_ID = publicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const REVOKE_CHARGE_SOL = parseFloat(process.env.REVOKE_CHARGE_SOL || '0.0999');

/**
 * Симулирует транзакцию и возвращает точную стоимость для payer'а
 * Использует изменение баланса payer'а из симуляции
 */
async function simulateTransaction(transaction, rpcUrl) {
  console.log('[simulateTransaction] Starting simulation...');
  
  const { Connection, Transaction: SolanaTransaction } = require('@solana/web3.js');
  const connection = new Connection(rpcUrl, 'confirmed');
  
  try {
    // Проверяем тип транзакции
    console.log('[simulateTransaction] Transaction type:', transaction.constructor.name);
    console.log('[simulateTransaction] Transaction properties:', {
      hasBlockhash: !!transaction.recentBlockhash,
      hasFeePayer: !!transaction.feePayer,
      instructionsCount: transaction.instructions?.length || 0,
      signaturesCount: transaction.signatures?.length || 0
    });
    
    // Убеждаемся, что feePayer установлен
    if (!transaction.feePayer) {
      console.error('[simulateTransaction] Transaction has no feePayer!');
      return null;
    }
    
    // Пробуем передать транзакцию напрямую (без сериализации/десериализации)
    // или как Buffer
    let simulation;
    
    // Попытка 1: Передаем транзакцию напрямую с replaceRecentBlockhash
    try {
      console.log('[simulateTransaction] Attempt 1: Direct transaction with replaceRecentBlockhash');
      simulation = await connection.simulateTransaction(transaction, {
        replaceRecentBlockhash: true,
        sigVerify: false,
      });
      console.log('[simulateTransaction] ✅ Simulation succeeded (direct with replaceRecentBlockhash)');
    } catch (error1) {
      console.warn('[simulateTransaction] Attempt 1 failed:', error1.message);
      
      // Попытка 2: Передаем как Buffer (сериализованную)
      try {
        console.log('[simulateTransaction] Attempt 2: Serialized transaction as Buffer');
        const serialized = transaction.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
        
        simulation = await connection.simulateTransaction(serialized, {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        console.log('[simulateTransaction] ✅ Simulation succeeded (as Buffer)');
      } catch (error2) {
        console.warn('[simulateTransaction] Attempt 2 failed:', error2.message);
        
        // Попытка 3: Создаем новую транзакцию из сериализованной и обновляем blockhash
        try {
          console.log('[simulateTransaction] Attempt 3: New transaction from serialized with fresh blockhash');
          const serialized = transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          });
          
          const { blockhash } = await connection.getLatestBlockhash('finalized');
          const newTx = SolanaTransaction.from(serialized);
          newTx.recentBlockhash = blockhash;
          newTx.feePayer = transaction.feePayer;
          
          simulation = await connection.simulateTransaction(newTx, {
            replaceRecentBlockhash: false,
            sigVerify: false,
          });
          console.log('[simulateTransaction] ✅ Simulation succeeded (new transaction with fresh blockhash)');
        } catch (error3) {
          console.error('[simulateTransaction] ❌ All attempts failed:', {
            attempt1: error1.message,
            attempt2: error2.message,
            attempt3: error3.message
          });
          throw error3;
        }
      }
    }
    
    console.log('[simulateTransaction] Simulation result received:', {
      hasValue: !!simulation?.value,
      hasAccounts: !!simulation?.value?.accounts,
      accountsCount: simulation?.value?.accounts?.length || 0,
      fee: simulation?.value?.fee || 0,
      err: simulation?.value?.err || null
    });
    
    if (!simulation?.value) {
      console.warn('[simulateTransaction] Simulation returned no value');
      return null;
    }
    
    if (simulation.value.err) {
      console.error('[simulateTransaction] Simulation error:', simulation.value.err);
      return null;
    }
    
    const fee = simulation.value.fee || 0;
    
    // Находим общее изменение баланса payer'а
    let totalPaid = 0;
    let rent = 0;
    
    if (simulation.value.accounts && simulation.value.accounts.length > 0) {
      console.log(`[simulateTransaction] Analyzing ${simulation.value.accounts.length} accounts...`);
      
      // Payer обычно первый аккаунт
      const payerAccount = simulation.value.accounts[0];
      if (payerAccount) {
        const preBalance = payerAccount.preLamports || 0;
        const postBalance = payerAccount.postLamports || 0;
        totalPaid = preBalance - postBalance; // Сколько payer заплатил (положительное число)
        
        // Rent = totalPaid - fee (потому что payer платит rent + fee)
        rent = Math.max(0, totalPaid - fee);
        
        console.log('[simulateTransaction] Payer balance change:', {
          preBalance: `${preBalance / 1_000_000_000} SOL`,
          postBalance: `${postBalance / 1_000_000_000} SOL`,
          totalPaid: `${totalPaid / 1_000_000_000} SOL`,
          fee: `${fee / 1_000_000_000} SOL`,
          rent: `${rent / 1_000_000_000} SOL`
        });
      } else {
        console.warn('[simulateTransaction] Payer account not found at index 0');
      }
    }
    
    // Fallback: если не нашли через accounts[0], используем fee как минимум
    // и ищем rent через самое большое положительное изменение (создание аккаунта)
    if (totalPaid === 0 && simulation.value.accounts) {
      console.warn('[simulateTransaction] Using fallback: searching for rent in all accounts');
      let maxRent = 0;
      simulation.value.accounts.forEach((acc, idx) => {
        if (acc) {
          const change = (acc.postLamports || 0) - (acc.preLamports || 0);
          if (change > 1000000) { // Больше 0.001 SOL - это rent
            maxRent = Math.max(maxRent, change);
            console.log(`[simulateTransaction] Account ${idx} rent: ${change / 1_000_000_000} SOL`);
          }
        }
      });
      rent = maxRent;
      totalPaid = rent + fee;
    }
    
    if (totalPaid === 0) {
      console.error('[simulateTransaction] Could not determine cost, returning null');
      return null;
    }
    
    console.log('[simulateTransaction] ✅ Final result:', {
      fee: `${fee / 1_000_000_000} SOL`,
      rent: `${rent / 1_000_000_000} SOL`,
      total: `${totalPaid / 1_000_000_000} SOL`
    });
    
    return { 
      fee, 
      rent, 
      total: totalPaid // Общая сумма, которую заплатит payer (rent + fee)
    };
  } catch (error) {
    console.error('[simulateTransaction] ❌ Error during simulation:', error.message);
    console.error('[simulateTransaction] Stack:', error.stack);
    console.error('[simulateTransaction] Error details:', {
      name: error.name,
      message: error.message,
      code: error.code
    });
    return null;
  }
}

/**
 * Возвращает стоимость метадаты на основе реальных данных
 * Не используем симуляцию - она не работает с UMI транзакциями
 * Используем реальное значение из транзакций: ~0.015 SOL
 */
async function estimateMetadataCost({ payerAddress, name, symbol, uri, rpcUrl }) {
  // Не пытаемся симулировать - используем реальное значение
  // Реальная стоимость из транзакций: 0.0151156 SOL = 15,115,600 lamports
  // Это включает rent для метаданных аккаунта + network fee
  
  // Можно немного варьировать в зависимости от размера данных
  // но для простоты используем фиксированное значение
  const baseCostLamports = 15_115_600; // 0.0151156 SOL
  
  // Небольшая корректировка на размер данных (опционально)
  // Для больших URI может быть немного больше
  const uriSize = (uri || '').length;
  const nameSize = (name || '').length;
  const symbolSize = (symbol || '').length;
  
  // Rent для метаданных зависит от размера данных
  // Минимальный размер аккаунта метаданных ~679 байт
  // Каждый байт данных увеличивает rent
  // Но для большинства случаев разница незначительна
  
  console.log('[estimateMetadataCost] Using real cost value:', {
    baseCost: `${baseCostLamports / 1_000_000_000} SOL`,
    dataSizes: { name: nameSize, symbol: symbolSize, uri: uriSize }
  });
  
  return {
    rentLamports: 15_000_000, // ~0.015 SOL rent
    feeLamports: 115_600,      // ~0.0001156 SOL fee
    totalLamports: baseCostLamports,
  };
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

async function addMetaplexMetadata({ mintAddress, mintSecretKey, payerAddress, name, symbol, uri, rpcUrl }) {
  const umi = createUmi(rpcUrl);
  const mint = publicKey(mintAddress);
  const payer = publicKey(payerAddress);
  const payerWeb3Js = new PublicKey(payerAddress);
  
  const onChainData = {
    name: sanitizeString(name),
    symbol: sanitizeString(symbol),
    uri: sanitizeString(uri || ''),
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
  
  const builder = createV1(umi, { 
    mint,
    splTokenProgram: TOKEN_2022_PROGRAM_ID,
    updateAuthority: payer,
    ...onChainData,
    isMutable: true,
    tokenStandard: TokenStandard.Fungible,
    payer,
  });
  
  const builderWithBlockhash = await builder.setLatestBlockhash(umi);
  const transaction = await builderWithBlockhash.build(umi);
  const web3LegacyTransaction = toWeb3JsLegacyTransaction(transaction);
  web3LegacyTransaction.feePayer = payerWeb3Js;
  web3LegacyTransaction.signatures = [];
  
  const serialized = web3LegacyTransaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  
  return {
    success: true,
    transaction: Buffer.from(serialized).toString('base64'),
  };
}

async function revokeUpdateAuthority({ mintAddress, payerAddress, rpcUrl, chargeTo = null }) {
  const umi = createUmi(rpcUrl);
  const mint = publicKey(mintAddress);
  const payer = publicKey(payerAddress);
  const payerWeb3Js = new PublicKey(payerAddress);

  const dummySigner = {
    publicKey: payer,
    signMessage: async () => { throw new Error('Should not be called'); },
    signTransaction: async () => { throw new Error('Should not be called'); },
    signAllTransactions: async () => { throw new Error('Should not be called'); },
  };
  umi.use(signerIdentity(dummySigner));

  const [metadataPda] = findMetadataPda(umi, { mint });
  
  // Проверяем текущий update authority
  console.log(`[revoke-update-authority] Checking metadata for mint: ${mintAddress}`);
  console.log(`[revoke-update-authority] Metadata PDA: ${metadataPda}`);
  
  try {
    const { Connection } = require('@solana/web3.js');
    const connection = new Connection(rpcUrl, 'confirmed');
    const metadataAccount = await connection.getAccountInfo(new PublicKey(metadataPda));
    
    if (!metadataAccount) {
      throw new Error(`Metadata account not found for mint ${mintAddress}`);
    }
    
    // Парсим метаданные для получения update authority
    // Структура: https://github.com/metaplex-foundation/metaplex-program-library/blob/master/token-metadata/program/src/state.rs
    // Update authority находится по смещению 1 (key) + 32 (update authority pubkey)
    const updateAuthorityBytes = metadataAccount.data.slice(1, 33);
    const currentUpdateAuthority = new PublicKey(updateAuthorityBytes);
    
    console.log(`[revoke-update-authority] Current update authority: ${currentUpdateAuthority.toBase58()}`);
    console.log(`[revoke-update-authority] Payer address: ${payerAddress}`);
    
    // Проверяем, что update authority уже revoked (все нули или null)
    const isRevoked = updateAuthorityBytes.every(byte => byte === 0);
    
    if (isRevoked) {
      console.log(`[revoke-update-authority] Update authority already revoked`);
      return {
        success: true,
        transaction: null,
        message: 'Update authority already revoked',
      };
    }
    
    // Проверяем, что payer является текущим update authority
    if (!currentUpdateAuthority.equals(payerWeb3Js)) {
      throw new Error(
        `Payer is not the current update authority. ` +
        `Current: ${currentUpdateAuthority.toBase58()}, ` +
        `Payer: ${payerAddress}`
      );
    }
    
    console.log(`[revoke-update-authority] Payer is the update authority, proceeding with revoke`);
  } catch (error) {
    console.error(`[revoke-update-authority] Error checking metadata:`, error);
    throw error;
  }

  // WORKAROUND: Metaplex bug - none() doesn't work for revoke
  // Transfer to System Program instead (11111111111111111111111111111111)
  // System Program cannot sign transactions, so this effectively revokes the authority
  const SYSTEM_PROGRAM_ID = publicKey('11111111111111111111111111111111');

  const builder = updateV1(umi, {
    mint,
    authority: payer,
    newUpdateAuthority: SYSTEM_PROGRAM_ID, // Use System Program instead of none()
    isMutable: false,
  });

  console.log(`[revoke-update-authority] updateV1 builder created with:`, {
    mint: mintAddress,
    authority: payerAddress,
    newUpdateAuthority: 'System Program (11111111111111111111111111111111)',
    isMutable: false,
  });

  const builderWithBlockhash = await builder.setLatestBlockhash(umi);
  const transaction = await builderWithBlockhash.build(umi);
  const web3LegacyTransaction = toWeb3JsLegacyTransaction(transaction);
  web3LegacyTransaction.feePayer = payerWeb3Js;
  web3LegacyTransaction.signatures = [];

  if (chargeTo) {
    const { SystemProgram } = require('@solana/web3.js');
    const chargeToPubkey = new PublicKey(chargeTo);
            const revokeChargeLamports = Math.floor(REVOKE_CHARGE_SOL * 1_000_000_000);
    
    const transferIx = SystemProgram.transfer({
      fromPubkey: payerWeb3Js,
      toPubkey: chargeToPubkey,
      lamports: revokeChargeLamports,
    });
    
    web3LegacyTransaction.add(transferIx);
            console.log(`[revoke-update-authority] Added charge transfer: ${revokeChargeLamports} lamports (${REVOKE_CHARGE_SOL} SOL) to ${chargeTo}`);
  }

  const serialized = web3LegacyTransaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });

  console.log(`[revoke-update-authority] Transaction instructions:`, 
    web3LegacyTransaction.instructions.map((ix, idx) => ({
      index: idx,
      programId: ix.programId.toBase58(),
      keysCount: ix.keys.length,
      dataLength: ix.data.length,
    }))
  );

  console.log(`[revoke-update-authority] Created transaction with ${web3LegacyTransaction.instructions.length} instructions`);

  return {
    success: true,
    transaction: Buffer.from(serialized).toString('base64'),
  };
}

module.exports = { addMetaplexMetadata, estimateMetadataCost, revokeUpdateAuthority };

