# 部署说明（Dream Server）

当前生产实例：`47.117.51.245`，目录 `/srv/blog/dream`，systemd 服务 `dream-server`，仅监听 `127.0.0.1:8787`。

> `/srv/blog` 是已有的博客应用；Dream 放在其子目录，互不影响。

## 组成

| 文件 | 说明 |
| --- | --- |
| `/srv/blog/dream/server.mjs` | esbuild 打包后的单文件服务端（含依赖，无需 node_modules） |
| `/srv/blog/dream/.env` | 密钥与配置，`600 dream:dream` |
| `/etc/systemd/system/dream-server.service` | 服务定义，开机自启 |
| `/opt/node22` | Node 22 LTS |

服务账号：`dream`（system 用户，无登录 shell）。

## 构建

```bash
npm install
npm run build:server      # -> apps/server/dist/server.mjs
```

## 首次上线

```bash
scp apps/server/dist/server.mjs root@HOST:/root/dream-server.mjs
scp deploy/dream-server.service root@HOST:/root/dream-server.service
# .env 参考 .env.example，至少包含 DEEPSEEK_API_KEY、DREAM_HOST=127.0.0.1
scp .env root@HOST:/root/dream.env

ssh root@HOST '
  install -o dream -g dream -m 600 /root/dream.env /srv/blog/dream/.env
  install -o dream -g dream -m 640 /root/dream-server.mjs /srv/blog/dream/server.mjs
  install -o root -g root -m 644 /root/dream-server.service /etc/systemd/system/dream-server.service
  rm -f /root/dream.env /root/dream-server.mjs /root/dream-server.service
  systemctl daemon-reload
  systemctl enable --now dream-server
'
```

## 更新

```bash
npm run build          # Web 产物（apps/web/dist）
npm run build:server   # 服务端 bundle
tar -C apps/web/dist -cf - . | ssh root@HOST 'rm -rf /srv/blog/dream/web.new && mkdir -p /srv/blog/dream/web.new && tar -C /srv/blog/dream/web.new -xf -'
ssh root@HOST 'rm -rf /srv/blog/dream/web.old && mv /srv/blog/dream/web /srv/blog/dream/web.old && mv /srv/blog/dream/web.new /srv/blog/dream/web && chown -R dream:dream /srv/blog/dream/web'
scp apps/server/dist/server.mjs root@HOST:/srv/blog/dream/server.mjs.new
ssh root@HOST 'install -o dream -g dream -m 640 /srv/blog/dream/server.mjs.new /srv/blog/dream/server.mjs && rm /srv/blog/dream/server.mjs.new && systemctl restart dream-server'
```

## 切换模型供应商

生产 `.env`（`/srv/blog/dream/.env`）默认 `DREAM_PROVIDER=deepseek`；切到 Qwen 时追加：

```bash
DREAM_PROVIDER=qwen
QWEN_API_KEY=sk-...
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.7-flash
```

然后 `systemctl restart dream-server`；前端无需重新构建，health 会返回新的 `provider` / `models`。

## 长对话压缩缓存

服务端会在 SQLite（`DREAM_DB_PATH`）中创建 `context_summaries` 表，缓存分段摘要；该表随数据库一起备份即可。摘要调用会消耗上游 Token，分段内容不变时不会重复调用。

## 运维

```bash
systemctl status dream-server
journalctl -u dream-server -f
curl -s http://127.0.0.1:8787/api/v1/health
```

## 访问方式（当前）

服务只绑定本机回环地址，公网通过 `dream-tunnel.service` 的 Cloudflare quick tunnel 暴露 HTTPS；所有 `/api/v1/*`（除 health/models）要求登录 Bearer Token。

```bash
# 本机调试
ssh -N -L 8787:127.0.0.1:8787 root@47.117.51.245
curl http://127.0.0.1:8787/api/v1/health
```

quick tunnel 的域名重启后会变化；固定域名需要 Cloudflare 命名隧道 + 子域名 DNS。若以后改挂 nginx，注意：`/api/v1/chat` 是 SSE，需要 `proxy_buffering off`、`proxy_read_timeout` 至少 300s，并保留 `X-Request-Id` 透传。

## 独立应用与账号（2026-11-19）

- 服务端与 Web 合并为单一进程：`server.mjs` 同时提供 `/api/v1/*` 与 `web/` 静态文件，`DREAM_WEB_DIR=/srv/blog/dream/web`。
- 账号：SQLite（`DREAM_DB_PATH=/srv/blog/dream/data/dream.db`），scrypt 密码哈希，`sessions` 表保存 token 哈希；`/api/v1/chat` 强制 Bearer 鉴权。
- systemd：`dream-server.service` 增加 `ReadWritePaths=/srv/blog/dream/data`（`ProtectSystem=strict` 下允许写库）；新增 `dream-tunnel.service` 运行 `cloudflared tunnel --url http://127.0.0.1:8787`。
- 当前公网入口（quick tunnel）：https://silicon-grip-contained-signal.trycloudflare.com 。重启后域名会变；固定域名需命名隧道 + 子域名 DNS。
