const express = require('express');
const router = express.Router();
const { 
  createTokenTransaction, 
  sendSignedTransaction 
} = require('../utils/transaction');
const { createSimpleToken } = require('../utils/transaction-simple');
const { createBaseToken2022 } = require('../utils/transaction-base');
const { addMetaplexMetadata, revokeUpdateAuthority } = require('../utils/metaplex-metadata');
const { createRevokeTransactions } = require('../utils/revoke-authority');

router.post('/create-simple-token', async (req, res) => {
  try {
    const {
      wallet,
      name,
      symbol,
      decimals = 9,
      priority_fee = 250000,
      rpc_url = 'https://api.devnet.solana.com',
    } = req.body;

    if (!wallet || !name || !symbol) {
      return res.status(400).json({ 
        success: false, 
        error: 'Wallet, name and symbol are required' 
      });
    }

    console.log('=== TEST: Creating simple token ===');

    const result = await createSimpleToken({
      wallet,
      name,
      symbol,
      decimals,
      priorityFee: priority_fee,
      rpcUrl: rpc_url,
    });

    res.json(result);

  } catch (error) {
    console.error('Error creating simple token:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/create-token
// Creates Token-2022 transaction, returns unsigned tx + mint_keypair for user to sign
router.post('/create-token', async (req, res) => {
  try {
    const {
      wallet,
      name,
      symbol,
      decimals = 9,
      description = '',
      image_uri = '', // URI изображения (IPFS), если есть
      priority_fee = 250000,
      rpc_url = 'https://api.devnet.solana.com',
      charge_to = null,
      fixed_charge_sol = 0
    } = req.body;

    // Validation
    if (!wallet) {
      return res.status(400).json({ 
        success: false, 
        error: 'Wallet address is required' 
      });
    }

    if (!name || !symbol) {
      return res.status(400).json({ 
        success: false, 
        error: 'Name and symbol are required' 
      });
    }

    console.log('Creating token transaction:', { wallet, name, symbol, decimals });

    // Create transaction (unsigned)
    const result = await createTokenTransaction({
      wallet,
      name,
      symbol,
      decimals,
      description,
      imageUri: image_uri, // только URI изображения
      priorityFee: priority_fee,
      rpcUrl: rpc_url,
      chargeTo: charge_to,
      fixedChargeSol: fixed_charge_sol
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Error creating token transaction:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/send-transaction
// Receives signed transaction and sends to Solana RPC
router.post('/send-transaction', async (req, res) => {
  try {
    const {
      signed_transaction,
      rpc_url = 'https://api.devnet.solana.com'
    } = req.body;

    if (!signed_transaction) {
      return res.status(400).json({
        success: false,
        error: 'signed_transaction is required'
      });
    }

    console.log('Sending signed transaction to RPC...');

    const result = await sendSignedTransaction({
      signedTransaction: signed_transaction,
      rpcUrl: rpc_url
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Error sending transaction:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/create-token-metaplex (NEW - Step 1)
// Creates base Token-2022 WITHOUT extensions
router.post('/create-token-metaplex', async (req, res) => {
  try {
    const {
      wallet,
      name,
      symbol,
      decimals = 9,
      supply,
      image_uri = '',
      priority_fee = 250000,
      rpc_url = 'https://api.devnet.solana.com',
      charge_to = null,
      fixed_charge_sol = 0,
    } = req.body;

    if (!wallet || !name || !symbol) {
      return res.status(400).json({ 
        success: false, 
        error: 'Wallet, name and symbol are required' 
      });
    }

    console.log('=== STEP 1: Creating base Token-2022 ===');

    const result = await createBaseToken2022({
      wallet,
      decimals,
      supply: supply ? Number(supply) : undefined,
      priorityFee: priority_fee,
      rpcUrl: rpc_url,
      chargeTo: charge_to,
      fixedChargeSol: fixed_charge_sol,
      name: name || '',
      symbol: symbol || '',
      uri: image_uri || '',
    });

    res.json({
      success: true,
      ...result,
      next_step: 'add_metadata',
      metadata: { name, symbol, uri: image_uri }
    });

  } catch (error) {
    console.error('Error creating base token:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/add-metaplex-metadata (NEW - Step 2)
// Adds Metaplex Token Metadata to existing mint
router.post('/add-metaplex-metadata', async (req, res) => {
  try {
    const {
      mint,
      mint_secret_key,
      payer,
      name,
      symbol,
      uri,
      rpc_url = 'https://api.devnet.solana.com',
    } = req.body;

    if (!mint || !mint_secret_key || !payer || !name || !symbol) {
      return res.status(400).json({ 
        success: false, 
        error: 'Mint, mint_secret_key, payer, name, and symbol are required' 
      });
    }

    console.log('=== STEP 2: Adding Metaplex metadata ===');
    console.log('Mint:', mint);

    const sanitizeString = (str) => {
      if (!str || typeof str !== 'string') return '';
      return str.replace(/\0/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '').trim();
    };

    const result = await addMetaplexMetadata({
      mintAddress: mint,
      mintSecretKey: mint_secret_key,
      payerAddress: payer,
      name: sanitizeString(name),
      symbol: sanitizeString(symbol),
      uri: sanitizeString(uri || ''),
      rpcUrl: rpc_url,
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Error adding metadata:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

router.post('/revoke-update-authority', async (req, res) => {
  try {
    const { mint, payer, rpc_url = 'https://api.devnet.solana.com', charge_to = null } = req.body;

    if (!mint || !payer) {
      return res.status(400).json({ 
        success: false, 
        error: 'Mint and payer are required' 
      });
    }

    const result = await revokeUpdateAuthority({
      mintAddress: mint,
      payerAddress: payer,
      rpcUrl: rpc_url,
      chargeTo: charge_to,
    });

    res.json(result);

  } catch (error) {
    console.error('Error revoking update authority:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/revoke-authority
// Creates revoke authority transactions for mint and/or freeze authority
router.post('/revoke-authority', async (req, res) => {
  try {
    const {
      wallet,
      mint_address,
      revoke_mint = false,
      revoke_freeze = false,
      priority_fee = 250000,
      rpc_url = 'https://api.devnet.solana.com',
      charge_to = null,
    } = req.body;

    if (!wallet || !mint_address) {
      return res.status(400).json({
        success: false,
        error: 'Wallet and mint_address are required',
      });
    }

    if (!revoke_mint && !revoke_freeze) {
      return res.status(400).json({
        success: false,
        error: 'At least one revoke (mint or freeze) must be requested',
      });
    }

    console.log('[revoke-authority] Request:', {
      wallet,
      mint_address,
      revoke_mint,
      revoke_freeze,
      priority_fee,
    });

    const result = await createRevokeTransactions({
      wallet,
      mintAddress: mint_address,
      revokeMint: revoke_mint,
      revokeFreeze: revoke_freeze,
      priorityFee: priority_fee,
      rpcUrl: rpc_url,
      chargeTo: charge_to,
    });

    res.json(result);
  } catch (error) {
    console.error('[revoke-authority] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;

