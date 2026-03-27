module.exports = {
  apps: [
    {
      name: "api",
      cwd: "/root/orcalist",
      script: "/root/orcalist/venv/bin/python",
      args: "-m uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'",
      env: {
        FIXED_CHARGE_SOL: "0.2",
        REVOKE_CHARGE_SOL: "0.0999",
        TOKEN_SERVICE_URL: "http://localhost:3001"
      },
      max_restarts: 10,
      restart_delay: 2000
    },
    {
      name: "token-service",
      cwd: "/root/orcalist/token-service",
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
      cwd: "/root/orcalist",
      exec_mode: "fork",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
}
