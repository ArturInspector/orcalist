// Example script to create Token-2022 with metadata and log instruction bytes
const {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  PublicKey,
} = require('@solana/web3.js');

const {
  TOKEN_2022_PROGRAM_ID,
  getMintLen,
  ExtensionType,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
} = require('@solana/spl-token');

const {
  createInitializeInstruction,
  pack,
  TokenMetadata,
} = require('@solana/spl-token-metadata');

async function main() {
  console.log('=== Token-2022 Metadata Instructions Example ===\n');

  // Create dummy keypairs for testing
  const payer = Keypair.generate();
  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  console.log(`Mint: ${mint.toBase58()}\n`);

  // Metadata to store in mint
  const metadata = {
    mint: mint,
    name: 'MyToken',
    symbol: 'MTK',
    uri: 'https://example.com/metadata.json',
    additionalMetadata: [],
  };

  // Calculate mint size with extensions
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = pack(metadata).length;
  const totalLen = mintLen + metadataLen;
  
  console.log(`Mint length: ${mintLen} bytes`);
  console.log(`Metadata length: ${metadataLen} bytes`);
  console.log(`Total length: ${totalLen} bytes\n`);

  // Calculate rent
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const lamports = await connection.getMinimumBalanceForRentExemption(totalLen);
  console.log(`Rent-exempt lamports: ${lamports}\n`);

  // Create transaction
  const transaction = new Transaction();

  // Instruction 0: Create account
  console.log('=== Instruction 0: Create Account ===');
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint,
    space: totalLen,
    lamports: lamports,
    programId: TOKEN_2022_PROGRAM_ID,
  });
  transaction.add(createAccountIx);
  console.log(`Program ID: ${createAccountIx.programId.toBase58()}`);
  console.log(`Data length: ${createAccountIx.data.length}`);
  console.log(`Data (hex): ${createAccountIx.data.toString('hex')}`);
  console.log(`Keys count: ${createAccountIx.keys.length}\n`);

  // Instruction 1: Initialize MetadataPointer
  console.log('=== Instruction 1: Initialize MetadataPointer ===');
  const initMetadataPointerIx = createInitializeMetadataPointerInstruction(
    mint,                    // mint
    payer.publicKey,        // authority
    mint,                   // metadata address (points to mint itself)
    TOKEN_2022_PROGRAM_ID   // programId
  );
  transaction.add(initMetadataPointerIx);
  console.log(`Program ID: ${initMetadataPointerIx.programId.toBase58()}`);
  console.log(`Data length: ${initMetadataPointerIx.data.length}`);
  console.log(`Data (hex): ${initMetadataPointerIx.data.toString('hex')}`);
  console.log(`Data (bytes): [${Array.from(initMetadataPointerIx.data).join(', ')}]`);
  console.log(`Keys count: ${initMetadataPointerIx.keys.length}`);
  initMetadataPointerIx.keys.forEach((key, i) => {
    console.log(`  Key[${i}]: ${key.pubkey.toBase58()}, signer=${key.isSigner}, writable=${key.isWritable}`);
  });
  console.log('');

  // Instruction 2: Initialize Mint
  console.log('=== Instruction 2: Initialize Mint ===');
  const decimals = 9;
  const initMintIx = createInitializeMintInstruction(
    mint,
    decimals,
    payer.publicKey,  // mint authority
    payer.publicKey,  // freeze authority
    TOKEN_2022_PROGRAM_ID
  );
  transaction.add(initMintIx);
  console.log(`Program ID: ${initMintIx.programId.toBase58()}`);
  console.log(`Data length: ${initMintIx.data.length}`);
  console.log(`Data (hex): ${initMintIx.data.toString('hex')}`);
  console.log(`Keys count: ${initMintIx.keys.length}\n`);

  // Instruction 3: Initialize Metadata
  console.log('=== Instruction 3: Initialize Metadata ===');
  const initMetadataIx = createInitializeInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    mint: mint,
    metadata: mint,  // metadata stored in mint account
    name: metadata.name,
    symbol: metadata.symbol,
    uri: metadata.uri,
    mintAuthority: payer.publicKey,
    updateAuthority: payer.publicKey,
  });
  transaction.add(initMetadataIx);
  console.log(`Program ID: ${initMetadataIx.programId.toBase58()}`);
  console.log(`Data length: ${initMetadataIx.data.length}`);
  console.log(`Data (hex): ${initMetadataIx.data.toString('hex')}`);
  console.log(`Data (bytes): [${Array.from(initMetadataIx.data).join(', ')}]`);
  console.log(`Keys count: ${initMetadataIx.keys.length}`);
  initMetadataIx.keys.forEach((key, i) => {
    console.log(`  Key[${i}]: ${key.pubkey.toBase58()}, signer=${key.isSigner}, writable=${key.isWritable}`);
  });
  console.log('');

  console.log('=== Summary ===');
  console.log(`Total instructions: ${transaction.instructions.length}`);
  console.log('\nInstruction order:');
  console.log('0. Create Account');
  console.log('1. Initialize MetadataPointer');
  console.log('2. Initialize Mint');
  console.log('3. Initialize Metadata');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

