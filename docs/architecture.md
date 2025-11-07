## High-Level Flow (Mermaid)

```mermaid
flowchart TD
    subgraph Client Layer
        A[Front-end Wallet]
    end

    subgraph Backend Layer
        B[FastAPI /api/proceed]
        B1[Validate wallet & config]
        B2[Attach fee payer & recent blockhash]
        B3[Append fixed charge transfer]
        C[FastAPI /api/listing]
        C1[Prepare SOL transfer transaction]
        D[Token Assembly Utils]
    end

    subgraph Solana Devnet
        E[RPC Node]
        F[SPL Token-2022 Program]
    end

    A -->|POST /api/proceed| B
    B --> B1
    B1 -->|Call create_token_transaction| D
    D -->|Build transaction with metadata extensions| B2
    B2 --> B3
    B3 -->|Serialize transaction (base64)| A

    A -->|POST /api/listing| C
    C --> C1
    C1 -->|Serialize transaction (base64)| A

    B2 -->|Fetch recent blockhash| E
    C1 -->|Fetch recent blockhash| E
    D -->|Use Token-2022 program ID| F
```