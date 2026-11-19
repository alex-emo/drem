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
npm run build:server
scp apps/server/dist/server.mjs root@HOST:/srv/blog/dream/server.mjs.new
ssh root@HOST 'install -o dream -g dream -m 640 /srv/blog/dream/server.mjs.new /srv/blog/dream/server.mjs && rm /srv/blog/dream/server.mjs.new && systemctl restart dream-server'
```

## 运维

```bash
systemctl status dream-server
journalctl -u dream-server -f
curl -s http://127.0.0.1:8787/api/v1/health
```

## 访问方式（当前）

服务只绑定本机回环地址，公网未开放。本机调试用 SSH 隧道：

```bash
ssh -N -L 8787:127.0.0.1:8787 root@47.117.51.245
# 另一个终端
curl http://127.0.0.1:8787/api/v1/health
```

**为什么不直接开放公网**：M1 登录/单设备鉴权尚未实现，直接暴露等于把 DeepSeek 配额交给任何扫到端口的人。上线公网前至少需要：

1. 完成 M1 鉴权（Bearer Token + 单设备互踢），或
2. 在 nginx 层加 Basic Auth / IP 白名单，并仅通过 HTTPS 暴露 `/api/`。

若后续要挂到现有 nginx，注意：`/api/v1/chat` 是 SSE，需要 `proxy_buffering off`、`proxy_read_timeout` 至少 300s，并保留 `X-Request-Id` 透传。
