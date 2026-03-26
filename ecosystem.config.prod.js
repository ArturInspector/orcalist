module.exports = {
  apps: [
    {
      name: "api",
      cwd: "/root/tokenstart/orcalist",
      script: "/root/tokenstart/orcalist/venv/bin/python",
      args: "-m uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'",
      env: {
        FIXED_CHARGE_SOL: "0.2",
        REVOKE_CHARGE_SOL: "0.0999",
        TOKEN_SERVICE_URL: "http://localhost:3001",
        CORS_ORIGINS: "https://tokenstart.pro,https://www.tokenstart.pro,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000",
        PINATA_JWT_TOKEN: process.env.PINATA_JWT_TOKEN || "",
        PINATA_API_KEY: process.env.PINATA_API_KEY || "",
        PINATA_SECRET_KEY: process.env.PINATA_SECRET_KEY || "",
        HELIUS_API_KEY: process.env.HELIUS_API_KEY || "",
        NETWORK: "mainnet",
        RPC_URL: process.env.RPC_URL || "",
        CHARGE_TO: process.env.CHARGE_TO || "HD7dHSFCuvDQqSUuCULA6ssrwceTVVYQwb9wc3iZG5rG"
      },
      max_restarts: 10,
      restart_delay: 2000
    },
    {
      name: "token-service",
      cwd: "/root/tokenstart/orcalist/token-service",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        TOKEN_SERVICE_PORT: "3001",
        NODE_ENV: "production",
        REVOKE_CHARGE_SOL: "0.0999"
      },
      max_restarts: 10,
      restart_delay: 2000
    },
    {
      name: "front",
      script: "npx",
      args: ["serve", "-s", "soltoken-frontend", "-l", "3000"],
      cwd: "/root/tokenstart/orcalist",
      exec_mode: "fork",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
}

