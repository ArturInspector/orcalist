module.exports = {
  apps: [
    {
      name: "api",
      cwd: "/home/ludskoe/kwork/soltoken",
      script: "/home/ludskoe/kwork/soltoken/venv/bin/python",
      args: "-m uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'",
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
      script: "/home/ludskoe/.nvm/versions/node/v20.19.5/lib/node_modules/pm2/lib/API/Serve.js",
      args: "/home/ludskoe/kwork/soltoken/soltoken-frontend 3000",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
}
