module.exports = {
  apps: [
    {
      name: "api",
      cwd: "/home/lyudskoe/projects/kwork/orcalist",
      script: "/home/lyudskoe/projects/kwork/orcalist/venv/bin/python",
      args: "-m uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'",
      env: {
        // Для использования Helius RPC раскомментируйте и укажите ваш API key:
        // HELIUS_API_KEY: "your-helius-api-key-here",
        // Или используйте прямой RPC URL:
        // RPC_URL: "https://devnet.helius-rpc.com/?api-key=your-helius-api-key-here",
        RPC_URL: "https://api.devnet.solana.com",
        CHARGE_TO: "GxdD2CM13WMgV7ikvsX6zPi6JbNoWN88RZbSNMfXsCuM",
        FIXED_CHARGE_SOL: "0.2",
        TOKEN_SERVICE_URL: "http://localhost:3001"
      },
      max_restarts: 10,
      restart_delay: 2000
    },
    {
      name: "token-service",
      cwd: "/home/lyudskoe/projects/kwork/orcalist/token-service",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      env: {
        TOKEN_SERVICE_PORT: "3001",
        NODE_ENV: "production"
      },
      max_restarts: 10,
      restart_delay: 2000
    },
    {
      name: "front",
      script: "/home/lyudskoe/.npm-global/bin/pm2",
      args: "serve /home/lyudskoe/projects/kwork/orcalist/soltoken-frontend --port 3000 --spa",
      exec_mode: "fork",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
}
