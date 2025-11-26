#!/bin/bash
# Тестовый скрипт для проверки /api/revoke-all
# Использование: ./test_revoke.sh <wallet> <mint_address> [revoke_mint] [revoke_freeze] [revoke_update]

API_BASE="http://127.0.0.1:8000"
WALLET="${1:-ER6pkyFKkFHYZpP8UfLc1xuFfagKnzgGPi5bc8zRZ4AP}"
MINT="${2}"
REVOKE_MINT="${3:-true}"
REVOKE_FREEZE="${4:-false}"
REVOKE_UPDATE="${5:-false}"

if [ -z "$MINT" ]; then
    echo "❌ Ошибка: нужно указать mint_address"
    echo "Использование: $0 <wallet> <mint_address> [revoke_mint] [revoke_freeze] [revoke_update]"
    echo ""
    echo "Пример:"
    echo "  $0 ER6pkyFKkFHYZpP8UfLc1xuFfagKnzgGPi5bc8zRZ4AP GKsPEwPs..."
    exit 1
fi

echo "🧪 Тестирование /api/revoke-all"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Wallet:     $WALLET"
echo "Mint:       $MINT"
echo "Revoke Mint:   $REVOKE_MINT"
echo "Revoke Freeze: $REVOKE_FREEZE"
echo "Revoke Update: $REVOKE_UPDATE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST "$API_BASE/api/revoke-all" \
    -H "Content-Type: application/json" \
    -d "{
        \"wallet\": \"$WALLET\",
        \"mint_address\": \"$MINT\",
        \"revoke_mint\": $REVOKE_MINT,
        \"revoke_freeze\": $REVOKE_FREEZE,
        \"revoke_update\": $REVOKE_UPDATE,
        \"priority_fee\": 250000
    }")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

echo "📤 Запрос:"
echo "POST $API_BASE/api/revoke-all"
echo ""
echo "📥 Ответ (HTTP $HTTP_CODE):"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
    SUCCESS=$(echo "$BODY" | jq -r '.success' 2>/dev/null)
    TX_COUNT=$(echo "$BODY" | jq -r '.transactions | length' 2>/dev/null)
    
    if [ "$SUCCESS" = "true" ]; then
        echo "✅ Успех!"
        echo "   Создано транзакций: $TX_COUNT"
        if [ "$TX_COUNT" = "0" ]; then
            MESSAGE=$(echo "$BODY" | jq -r '.message // "No message"' 2>/dev/null)
            echo "   Сообщение: $MESSAGE"
        fi
    else
        ERROR=$(echo "$BODY" | jq -r '.detail // .error // .message' 2>/dev/null)
        echo "❌ Ошибка: $ERROR"
    fi
else
    ERROR=$(echo "$BODY" | jq -r '.detail // .error // .message' 2>/dev/null)
    echo "❌ HTTP $HTTP_CODE: $ERROR"
fi

