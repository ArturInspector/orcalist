module.exports = {
  apps: [
    {
      name: "api",
      cwd: "/root/soltokenmint",
      script: "uvicorn",
      args: "main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'",
      interpreter: "/root/soltokenmint/.venv/bin/python",
      env: {
        RPC_URL: "https://api.devnet.solana.com",
        CHARGE_TO: "GxdD2CM13WMgV7ikvsX6zPi6JbNoWN88RZbSNMfXsCuM",
        FIXED_CHARGE_SOL: "0.02"
      },
      max_restarts: 10,
      restart_delay: 2000
    },
    {
      name: "front",
      script: "pm2",
      args: "serve /root/soltokenmint/soltoken-frontend 3000 --spa",
      env: {
        // если фронт ходит к этому же бэку, в steps.js просто ставь API_BASE="")
        NODE_ENV: "production"
      }
    }
  ]
}
