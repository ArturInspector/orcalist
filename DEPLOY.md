# План деплоя OrcaList (TokenStart)

## Различия между локальной и продовой средой

### 1. API_BASE (Фронтенд → Бэкенд)

**Локально:**
- Фронтенд на порту 3000 (`npx serve`)
- API_BASE определяется автоматически: `http://localhost:8000` или `http://127.0.0.1:8000`
- Можно задать через meta tag: `<meta name="api-base" content="http://127.0.0.1:8000">`

**На проде:**
- Фронтенд на портах 80/443 через nginx
- API_BASE = пустая строка (относительный путь)
- Все запросы идут через nginx, который проксирует на нужные сервисы

**Код:** `soltoken-frontend/js/formNew/steps.v2.js:10-42`

### 2. NGINX маршрутизация

**На проде nginx проксирует:**
- `/api/create-token-metaplex` → `http://127.0.0.1:3001` (Token Service)
- `/api/add-metaplex-metadata` → `http://127.0.0.1:3001` (Token Service)
- `/api/send-transaction` → `http://127.0.0.1:3001` (Token Service)
- `/api/*` (остальные) → `http://127.0.0.1:8000` (Python API)
- `/` (фронтенд) → `http://127.0.0.1:8000` (Python API отдает статику)

**Локально:**
- Нет nginx, все запросы идут напрямую на порты

### 3. NETWORK (devnet/mainnet)

**Локально:**
- `ecosystem.config.js` - NETWORK не задан (по умолчанию `devnet`)
- `config.py` - читает `NETWORK` из env, по умолчанию `devnet`

**На проде:**
- `ecosystem.prod.config.js` - NETWORK не задан (по умолчанию `devnet`)
- Нужно явно задать `NETWORK=devnet` для тестирования, затем `NETWORK=mainnet`

**Где используется:**
- `config.py:8` - Python API
- `token-service/routes/token.js:13` - Token Service
- Определяет RPC URL (Helius devnet/mainnet)

### 4. CORS

**Локально:**
- Дефолтные origins включают `localhost:3000`, `127.0.0.1:3000`, `localhost:8000`

**На проде:**
- Задается через `CORS_ORIGINS` env переменную
- В `ecosystem.prod.config.js` уже задано: `https://tokenstart.pro,https://www.tokenstart.pro,...`

**Код:** `main.py:24-37`

### 5. Ссылки на Explorer/Solscan

**Проблема:** Хардкод `devnet` в коде фронтенда

**Локально:** Всегда `?cluster=devnet`
**На проде:** Всегда `?cluster=devnet` (даже если mainnet!)

**Код:** `steps.v2.js:788-789, 760-761`

**Решение:** Использовать значение из `/api/config` endpoint

### 6. Пути к файлам

**Локально:**
- `cwd: /home/lyudskoe/projects/kwork/orcalist`
- `script: /home/lyudskoe/projects/kwork/orcalist/venv/bin/python`

**На проде:**
- `cwd: /root/tokenstart/orcalist`
- `script: /root/tokenstart/orcalist/venv/bin/python`

## План деплоя

### Этап 1: Локальная разработка (devnet)

1. **Настроить NETWORK=devnet**
   ```bash
   # В ecosystem.config.js добавить:
   env: {
     NETWORK: "devnet",
     ...
   }
   ```

2. **Запустить сервисы локально**
   ```bash
   pm2 start ecosystem.config.js
   ```

3. **Проверить работу**
   - Фронт: http://localhost:3000
   - API: http://localhost:8000
   - Token Service: http://localhost:3001

4. **Исправить баги**
   - JSON.parse ошибки (добавить safeJsonParse)
   - Убрать хардкод devnet из ссылок explorer

### Этап 2: Деплой на прод (devnet для теста)

1. **Подготовить конфигурацию**
   ```bash
   # На сервере создать .env файл с NETWORK=devnet
   # Обновить ecosystem.prod.config.js с NETWORK=devnet
   ```

2. **Деплой через git**
   ```bash
   git pull origin main
   pm2 restart ecosystem.prod.config.js
   ```

3. **Проверить nginx**
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

4. **Тестирование на проде**
   - Создать тестовый токен на devnet
   - Проверить все эндпоинты
   - Проверить ссылки на explorer (должны быть devnet)

### Этап 3: Переход на mainnet

1. **Обновить конфигурацию**
   ```bash
   # В ecosystem.prod.config.js изменить:
   env: {
     NETWORK: "mainnet",
     ...
   }
   ```

2. **Проверить переменные окружения**
   - `HELIUS_API_KEY` должен быть валидным
   - `CHARGE_TO` должен быть правильным адресом
   - `PINATA_JWT_TOKEN` должен быть настроен

3. **Перезапустить сервисы**
   ```bash
   pm2 restart ecosystem.prod.config.js
   ```

4. **Проверить работу**
   - `/api/config` должен вернуть `"network": "mainnet"`
   - Ссылки на explorer должны быть без `?cluster=devnet` или с `?cluster=mainnet`

## Чеклист перед деплоем

- [ ] NETWORK задан в ecosystem.config
- [ ] CORS_ORIGINS настроен для прода
- [ ] HELIUS_API_KEY валидный
- [ ] PINATA_JWT_TOKEN настроен
- [ ] CHARGE_TO адрес правильный
- [ ] Пути к файлам правильные (prod vs local)
- [ ] NGINX конфиг обновлен
- [ ] Хардкод devnet убран из ссылок explorer
- [ ] JSON.parse ошибки исправлены

## Переменные окружения

### Обязательные для прода:
- `NETWORK` - `devnet` или `mainnet`
- `HELIUS_API_KEY` - для RPC запросов
- `PINATA_JWT_TOKEN` - для IPFS загрузок
- `CHARGE_TO` - адрес для получения платежей
- `CORS_ORIGINS` - список разрешенных origins через запятую

### Опциональные:
- `FIXED_CHARGE_SOL` - фиксированная плата (по умолчанию 0.2)
- `REVOKE_CHARGE_SOL` - плата за revoke (по умолчанию 0.0999)
- `SOLANA_RPC_URL` - кастомный RPC (если нет HELIUS_API_KEY)

## Команды для деплоя

```bash
# Локально
pm2 start ecosystem.config.js
pm2 logs

# На проде
pm2 start ecosystem.prod.config.js
pm2 logs

# Проверка статуса
pm2 status
pm2 monit

# Перезапуск
pm2 restart ecosystem.prod.config.js

# Проверка nginx
sudo nginx -t
sudo systemctl reload nginx
```

## Откат на предыдущую версию

```bash
# Откатить git
git reset --hard <commit-hash>

# Перезапустить сервисы
pm2 restart ecosystem.prod.config.js

# Проверить логи
pm2 logs --lines 100
```

