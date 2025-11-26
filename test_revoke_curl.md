# Тестирование /api/revoke-all

## Быстрый curl для тестирования

### Базовый запрос (revoke mint)
```bash
# Замените WALLET_ADDRESS и MINT_ADDRESS на ваши значения
curl -X POST http://127.0.0.1:8000/api/revoke-all \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "YOUR_WALLET_ADDRESS",
    "mint_address": "4dwhcbf6oNwniMxMNxafzREhL2JbF1XQR4XbfeYbuGXE",
    "revoke_mint": true,
    "revoke_freeze": false,
    "revoke_update": false,
    "priority_fee": 250000
  }'
```

### Revoke все (mint + freeze + update)
```bash
curl -X POST http://127.0.0.1:8000/api/revoke-all \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "ER6pkyFKkFHYZpP8UfLc1xuFfagKnzgGPi5bc8zRZ4AP",
    "mint_address": "GKsPEwPst8xipKKkQpgAwofJnjfKLcCgoVKzFnmRiz9i",
    "revoke_mint": true,
    "revoke_freeze": true,
    "revoke_update": true,
    "priority_fee": 250000
  }'
```

### С форматированием ответа (требует jq)
```bash
curl -X POST http://127.0.0.1:8000/api/revoke-all \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "ER6pkyFKkFHYZpP8UfLc1xuFfagKnzgGPi5bc8zRZ4AP",
    "mint_address": "GKsPEwPst8xipKKkQpgAwofJnjfKLcCgoVKzFnmRiz9i",
    "revoke_mint": true,
    "revoke_freeze": true,
    "revoke_update": true,
    "priority_fee": 250000
  }' | jq '.'
```

## Использование тестового скрипта

```bash
# Базовый тест (revoke mint)
./test_revoke.sh ER6pkyFKkFHYZpP8UfLc1xuFfagKnzgGPi5bc8zRZ4AP GKsPEwPst8xipKKkQpgAwofJnjfKLcCgoVKzFnmRiz9i

# Revoke все
./test_revoke.sh ER6pkyFKkFHYZpP8UfLc1xuFfagKnzgGPi5bc8zRZ4AP GKsPEwPst8xipKKkQpgAwofJnjfKLcCgoVKzFnmRiz9i true true true

# Только freeze
./test_revoke.sh ER6pkyFKkFHYZpP8UfLc1xuFfagKnzgGPi5bc8zRZ4AP GKsPEwPst8xipKKkQpgAwofJnjfKLcCgoVKzFnmRiz9i false true false
```

## Ожидаемые ответы

### ✅ Успех (транзакции созданы)
```json
{
  "success": true,
  "transactions": [
    "base64_encoded_transaction_1",
    "base64_encoded_transaction_2"
  ]
}
```

### ✅ Успех (все уже revoked)
```json
{
  "success": true,
  "transactions": [],
  "message": "All requested authorities are already revoked"
}
```

### ❌ Ошибка (wallet не является authority)
```json
{
  "detail": "Wallet is not the mint authority. Current mint authority: ..."
}
```

### ❌ Ошибка (mint не найден)
```json
{
  "detail": "Mint not found"
}
```

## Важно

- Каждая revoke транзакция содержит transfer на **0.0999 SOL** (99,900,000 lamports)
- В UI отображается **0.1 SOL** для удобства пользователя
- Реальная стоимость: 0.0999 SOL за каждый revoke

