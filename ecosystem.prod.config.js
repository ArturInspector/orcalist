const path = require("path");
const root = process.env.ORCALIST_ROOT
  ? path.resolve(process.env.ORCALIST_ROOT)
  : path.resolve(__dirname);

module.exports = {
  apps: [
    {
      name: "api",
      cwd: root,
      script: path.join(root, "venv/bin/python"),
      args: "-m uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'",
      env: {
        FIXED_CHARGE_SOL: "0.2",
        REVOKE_CHARGE_SOL: "0.0999",
        TOKEN_SERVICE_URL: "http://localhost:3001",
        CORS_ORIGINS:
          "https://tokenstart.pro,https://www.tokenstart.pro,https://tokenx.run,https://www.tokenx.run,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000",
        // Секреты только из .env в cwd (root). Не передавать PINATA/HELIUS пустыми строками —
        // иначе load_dotenv() в Python их не перезапишет и бэк живёт без ключей.
        NETWORK: "mainnet"
      },
      max_restarts: 10,
      restart_delay: 2000
    },
    {
      name: "token-service",
      cwd: path.join(root, "token-service"),
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        TOKEN_SERVICE_PORT: "3001",
        NODE_ENV: "production",
        REVOKE_CHARGE_SOL: "0.0999",
        NETWORK: "mainnet"
      },
      max_restarts: 10,
      restart_delay: 2000
    },
    {
      name: "front",
      script: "npx",
      args: ["serve", "-s", "soltoken-frontend", "-l", "3000"],
      cwd: root,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
