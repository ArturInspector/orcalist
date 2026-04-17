# Стратегия управления Git репозиторием

## Текущая проблема

Сейчас у нас один репозиторий с разными конфигурациями для локальной разработки и прода:
- `ecosystem.config.js` - локальная разработка
- `ecosystem.prod.config.js` - продакшн (имя должно содержать `.config.js` — иначе PM2 не парсит apps)
- Разные пути к файлам (`/home/lyudskoe/` vs `/root/tokenstart/`)
- Разные настройки API_BASE (локально через порты, на проде через nginx)
- Хардкод devnet в коде фронтенда

Это приводит к:
- Путанице при деплое
- Ошибкам из-за неправильных путей
- Сложности в поддержке

## Варианты решения

### Вариант 1: Разделение на отдельные репозитории (РЕКОМЕНДУЕТСЯ)

**Структура:**
```
orcalist-dev/          # Репозиторий для разработки
  ├── ecosystem.config.js (локальные пути)
  ├── .env.example (devnet настройки)
  └── код проекта

orcalist-prod/         # Репозиторий для продакшна
  ├── ecosystem.config.js (продовые пути)
  ├── .env.example (mainnet настройки)
  ├── nginx.tokenx.run.conf
  └── код проекта (синхронизируется с dev)
```

**Плюсы:**
- Четкое разделение сред
- Нет риска случайно задеплоить dev конфиг на прод
- Упрощенный деплой (просто git pull)
- Можно иметь разные .gitignore для разных сред

**Минусы:**
- Нужно синхронизировать код между репо
- Два репозитория для поддержки

**Как синхронизировать:**
```bash
# В orcalist-dev после изменений
git push origin main

# В orcalist-prod
git remote add dev-origin <url-to-dev-repo>
git pull dev-origin main --allow-unrelated-histories
# Или использовать git subtree/submodule
```

### Вариант 2: Разделение на ветки (ПРОСТОЙ)

**Структура:**
```
main (или master)
  ├── ecosystem.config.js (шаблон)
  └── код проекта

develop
  ├── ecosystem.config.js (локальные настройки)
  └── код проекта

production
  ├── ecosystem.config.js (продовые настройки)
  ├── nginx.tokenx.run.conf
  └── код проекта
```

**Плюсы:**
- Один репозиторий
- Простое переключение между средами
- Git flow стандарт

**Минусы:**
- Нужно мержить изменения между ветками
- Риск задеплоить не ту ветку

**Workflow:**
```bash
# Разработка
git checkout develop
# делаем изменения
git commit -m "fix: исправлен JSON.parse"
git push origin develop

# Деплой на прод
git checkout production
git merge develop
# Обновляем ecosystem.config.js для прода
git commit -m "chore: обновлена конфигурация для прода"
git push origin production

# На сервере
git checkout production
git pull origin production
pm2 restart ecosystem.config.js
```

### Вариант 3: Один репозиторий с переменными окружения (СЛОЖНЫЙ)

**Структура:**
```
main
  ├── ecosystem.config.js (использует env переменные)
  ├── .env.local (не в git)
  ├── .env.prod (не в git)
  └── код проекта
```

**Плюсы:**
- Один репозиторий
- Один конфиг файл

**Минусы:**
- Сложная логика в ecosystem.config.js
- Риск ошибок при деплое
- Нужно правильно настраивать .env на сервере

## Рекомендация: Вариант 2 (Ветки) + улучшения

### Предлагаемая структура веток:

```
main                    # Стабильная версия для прода
  └── ecosystem.config.js (продовые пути, читает NETWORK из env)

develop                 # Разработка
  └── ecosystem.config.js (локальные пути, NETWORK=devnet)

feature/*               # Функциональные ветки
hotfix/*                # Срочные исправления
```

### Улучшения в коде:

1. **Убрать хардкод путей из ecosystem.config.js**
   ```javascript
   // Использовать переменные окружения
   cwd: process.env.PROJECT_DIR || "/home/lyudskoe/projects/kwork/orcalist",
   script: process.env.PYTHON_VENV || "/home/lyudskoe/projects/kwork/orcalist/venv/bin/python",
   ```

2. **Убрать хардкод devnet из фронтенда**
   ```javascript
   // В steps.v2.js использовать значение из /api/config
   const config = await fetch(`${API_BASE}/api/config`).then(r => r.json());
   const network = config.network || "devnet";
   const explorerUrl = `https://explorer.solana.com/address/${mint}?cluster=${network}`;
   ```

3. **Создать .env.example файлы**
   ```bash
   # .env.example
   NETWORK=devnet
   HELIUS_API_KEY=your_key_here
   PINATA_JWT_TOKEN=your_token_here
   CHARGE_TO=your_address_here
   CORS_ORIGINS=https://tokenstart.pro,https://www.tokenstart.pro
   ```

4. **Упростить ecosystem.config.js**
   ```javascript
   // ecosystem.config.js - один файл для всех сред
   const PROJECT_DIR = process.env.PROJECT_DIR || "/home/lyudskoe/projects/kwork/orcalist";
   const PYTHON_VENV = process.env.PYTHON_VENV || `${PROJECT_DIR}/venv/bin/python`;
   const NETWORK = process.env.NETWORK || "devnet";
   
   module.exports = {
     apps: [{
       name: "api",
       cwd: PROJECT_DIR,
       script: PYTHON_VENV,
       env: {
         NETWORK: NETWORK,
         // ...
       }
     }]
   };
   ```

## План миграции

### Шаг 1: Подготовка (сейчас)

1. Создать ветку `develop`
2. Обновить `ecosystem.config.js` для использования env переменных
3. Убрать хардкод devnet из фронтенда
4. Создать `.env.example` файлы

### Шаг 2: Рефакторинг ecosystem.config.js

1. Объединить `ecosystem.config.js` и `ecosystem.prod.config.js` в один файл
2. Использовать переменные окружения для путей
3. Убрать все хардкоды

### Шаг 3: Настройка на сервере

1. Создать `.env` файл на сервере с продовыми настройками
2. Обновить `ecosystem.config.js` на сервере
3. Убедиться что все работает

### Шаг 4: Документация

1. Обновить README.md с инструкциями
2. Создать DEPLOY.md (уже создан)
3. Обновить GIT.md (этот файл)

## Команды для работы с ветками

```bash
# Создать ветку develop
git checkout -b develop
git push -u origin develop

# Разработка в feature ветке
git checkout develop
git checkout -b feature/fix-json-parse
# делаем изменения
git commit -m "fix: исправлен JSON.parse"
git push origin feature/fix-json-parse

# Мерж в develop
git checkout develop
git merge feature/fix-json-parse
git push origin develop

# Деплой на прод (мерж develop в main)
git checkout main
git merge develop
git push origin main

# На сервере
git checkout main
git pull origin main
pm2 restart ecosystem.config.js
```

## .gitignore обновления

```gitignore
# Конфигурация
.env
.env.local
.env.prod
*.env

# Но оставить примеры
!.env.example
!.env.local.example
!.env.prod.example

# PM2
.pm2/
ecosystem.config.local.js
```

## Итоговая структура файлов

```
orcalist/
├── .env.example              # Шаблон переменных окружения
├── ecosystem.config.js       # Один конфиг для всех сред (читает env)
├── nginx.tokenx.run.conf  # NGINX конфиг для прода
├── DEPLOY.md                  # Документация по деплою
├── GIT.md                     # Этот файл
├── config.py                  # Python конфиг (читает env)
├── main.py
├── api/
├── soltoken-frontend/
└── token-service/
```

## Рекомендации

1. **Использовать Вариант 2 (ветки)** - проще всего внедрить
2. **Убрать все хардкоды** - использовать env переменные
3. **Один ecosystem.config.js** - читает настройки из env
4. **Четкий workflow** - develop → main → deploy
5. **Документация** - все изменения документировать

## Следующие шаги

1. [ ] Создать ветку develop
2. [ ] Рефакторить ecosystem.config.js для использования env
3. [ ] Убрать хардкод devnet из фронтенда
4. [ ] Создать .env.example файлы
5. [ ] Обновить .gitignore
6. [ ] Протестировать на локальной машине
7. [ ] Обновить конфигурацию на сервере
8. [ ] Протестировать деплой

