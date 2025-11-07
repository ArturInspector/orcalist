# Token Creation Flow

## Определения
- **Mint Account**: PDA (Program Derived Address), содержащий метаданные токена
- **Mint Authority**: Pubkey, имеющий право вызывать `MintTo` instruction
- **Token Account**: Аккаунт, содержащий balance конкретного токена для владельца

## Предусловия
1. Server wallet имеет ≥ 0.05 SOL для rent exemption
2. Metadata URI доступен и возвращает валидный JSON
3. Decimals ∈ [0, 9] (ограничение SPL Token)

## Алгоритм создания

### Шаг 1: Генерация Mint Keypair
```
Вход: ∅
Выход: (publicKey, secretKey) где publicKey - Ed25519 public key
Реализация: Keypair.generate()
Гарантии: Криптографически случайная пара ключей
```

### Шаг 2: Расчёт Rent Exemption
```
Вход: размер Mint Account с metadata extension
Формула: rent = lamports_per_byte_year × account_size × years
RPC: getMinimumBalanceForRentExemption(account_size)
Результат: lamports для бессрочного хранения
```

### Шаг 3: Построение Transaction
```
Instructions:
1. SystemProgram.createAccount({
     fromPubkey: serverWallet.publicKey,
     newAccountPubkey: mintKeypair.publicKey,
     lamports: rentLamports,
     space: MINT_SIZE + METADATA_EXTENSION_SIZE,
     programId: TOKEN_2022_PROGRAM_ID
   })
   
2. createInitializeMintInstruction({
     mint: mintKeypair.publicKey,
     decimals: decimals,
     mintAuthority: serverWallet.publicKey,
     freezeAuthority: serverWallet.publicKey | null
   })
   
3. createInitializeMetadataInstruction({
     mint: mintKeypair.publicKey,
     metadata: { name, symbol, uri }
   })

Подписи: [serverWallet, mintKeypair]
```

### Шаг 4: Отправка и Confirmation
```
RPC: sendTransaction(transaction, [serverWallet, mintKeypair])
→ transaction_signature (base58 string)

RPC: confirmTransaction(signature, commitment='finalized')
→ {slot, confirmationStatus, err}

Условие успеха: err === null AND confirmationStatus === 'finalized'
```

## Постусловия
1. ∃ Mint Account по адресу mintKeypair.publicKey
2. Mint Authority = serverWallet.publicKey
3. Supply = 0 (ещё не заминчено)
4. Metadata доступна через getTokenMetadata(mint)

## Инварианты
- Mint Authority может быть изменён только текущим Authority
- Supply может увеличиваться только через MintTo от Authority
- Если Freeze Authority = null, заморозка невозможна навсегда

## Точки отказа
1. Недостаточно SOL → HTTPException(402, "Insufficient funds")
2. RPC timeout → retry с экспоненциальной задержкой
3. Transaction failed → parse error из logs, вернуть причину
4. Invalid metadata URI → HTTPException(400, "Metadata unreachable")