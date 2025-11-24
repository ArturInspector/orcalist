// ТЕСТОВЫЙ ФАЙЛ: Создание Token-2022 БЕЗ метаданных
// Цель: Проверить базовую функциональность Token-2022

const {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  PublicKey,
  TransactionInstruction,
} = require('@solana/web3.js');

const {
  TOKEN_2022_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMintInstruction,
} = require('@solana/spl-token');

/**
 * TEST: Create simple Token-2022 without any extensions
 */
async function createSimpleToken({
  wallet,
  name,
  symbol,
  decimals = 9,
  priorityFee = 250000,
  rpcUrl = 'https://api.devnet.solana.com',
}) {
  console.log('=== TEST: Creating SIMPLE Token-2022 (no extensions) ===');
  console.log('Params:', { wallet, name, symbol, decimals });

  const connection = new Connection(rpcUrl, 'confirmed');
  const payer = new PublicKey(wallet);
  
  // Generate mint keypair
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  
  console.log('Generated mint:', mint.toBase58());

  // Simple mint size (no extensions)
  const mintLen = MINT_SIZE; // 82 bytes for basic mint
  console.log(`Mint size: ${mintLen} bytes (basic, no extensions)`);

  // Get rent
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);
  console.log(`Rent-exempt: ${lamports} lamports`);

  // Create transaction
  const transaction = new Transaction();

  // Add priority fee
  const priorityFeeIx = new TransactionInstruction({
    keys: [],
    programId: new PublicKey('ComputeBudget111111111111111111111111111111'),
    data: Buffer.from([
      3, // SetComputeUnitPrice instruction
      ...new Uint8Array(new BigUint64Array([BigInt(priorityFee)]).buffer)
    ])
  });
  transaction.add(priorityFeeIx);

  // Instruction 1: Create account
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: payer,
    newAccountPubkey: mint,
    space: mintLen,
    lamports: lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  });
  transaction.add(createAccountIx);

  // Instruction 2: Initialize Mint (basic, no extensions)
  const initMintIx = createInitializeMintInstruction(
    mint,
    decimals,
    payer,
    payer,
    TOKEN_2022_PROGRAM_ID
  );
  transaction.add(initMintIx);

  // Set fee payer and blockhash
  transaction.feePayer = payer;
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = blockhash;

  // Sign with mint keypair
  transaction.partialSign(mintKeypair);
  console.log('Transaction partially signed with mint keypair');

  // Serialize
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  const base64Transaction = serialized.toString('base64');

  console.log('Simple token transaction created successfully');
  console.log(`Instructions: ${transaction.instructions.length}`);
  console.log(`Size: ${serialized.length} bytes`);

  return {
    success: true,
    mint: mint.toBase58(),
    transaction: base64Transaction,
    blockhash: blockhash,
    instructions_count: transaction.instructions.length,
    size: serialized.length
  };
}

module.exports = {
  createSimpleToken
};

