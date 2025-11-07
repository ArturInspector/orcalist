Пример структуры (НЕ РАЗБИВАЙ ФАЙЛ ИЗЛИШНЕ на много пайпланов.)

В проекте всего около 2-3 пайплайнов, пиши так:

# Main Pipelines

Core user-facing flows in the system. Each pipeline describes end-to-end interaction from request to response.

---

## P1: Token Creation Pipeline

## High-Level Flow (Mermaid)
[вставь Mermaid диаграмму]! ОБЯЗАТЕЛЬНО!

### Purpose
Create new SPL Token-2022 with metadata extension on Solana devnet.

### Entry Point
`POST /api/v1/proceed`

### Input Schema
```python