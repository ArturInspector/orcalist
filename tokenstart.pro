# HTTP → HTTPS redirect
server {
    listen 80;
    server_name tokenstart.pro www.tokenstart.pro;
    return 301 https://tokenstart.pro$request_uri;
}

# HTTPS - ВСЕ через Python API на порт 8000
server {
    listen 443 ssl;
    server_name tokenstart.pro www.tokenstart.pro;

    ssl_certificate /etc/letsencrypt/live/tokenstart.pro/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tokenstart.pro/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # ВСЕ запросы → Python API на порт 8000
    # Python API сам отдает фронтенд (StaticFiles) и обрабатывает API
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }

    client_max_body_size 20m;
}
