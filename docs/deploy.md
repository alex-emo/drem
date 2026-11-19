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
# 多个密钥用逗号分隔，服务端会轮询并在失败时自动切换
QWEN_API_KEYS=key1,key2,key3
QWEN_API_KEY=sk-...
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen3.7-flash
```

然后 `systemctl restart dream-server`；前端无需重新构建，health 会返回新的 `provider` / `models`。

## 管理员看板

生产 `.env` 增加管理员名单（逗号分隔，大小写不敏感），重启服务后生效：

```bash
DREAM_ADMIN_USERS=Alex
```

管理员访问 `https://dream.pum.org.cn/admin`，可查看用户、请求次数、输入/输出 Token，以及每个 Key 的用量和冷却状态。Token 明细写入 SQLite `usage_events` 表，随 `DREAM_DB_PATH` 一起备份。非管理员访问会返回 403。

## 长对话压缩缓存

服务端会在 SQLite（`DREAM_DB_PATH`）中创建 `context_summaries` 表缓存分段摘要，以及 `usage_events` 表记录每个请求的 Token 用量；两表都随数据库一起备份即可。摘要调用会消耗上游 Token，分段内容不变时不会重复调用。

## 固定域名（命名隧道）

Dream 使用独立的 Cloudflare 命名隧道 `dream`（Tunnel ID `21e95c01-02ab-4e7b-97a1-78c1c6061515`）暴露 `https://dream.pum.org.cn`，与博客的 `cloudflared.service` 互不影响。

1. 控制台创建隧道后，把安装命令里的完整 token 写入 `/etc/cloudflared/dream-token`：

   ```bash
   sudo mkdir -p /etc/cloudflared
   sudo sh -c "printf '%s\n' '<token>' > /etc/cloudflared/dream-token"
   sudo chmod 600 /etc/cloudflared/dream-token
   ```

   不要执行面板里的 `cloudflared service install <token>`，那会覆盖博客现有的 `cloudflared.service`。

2. 安装本仓库的 `deploy/dream-named-tunnel.service`：

   ```bash
   sudo cp deploy/dream-named-tunnel.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now dream-named-tunnel
   ```

   服务用 `cloudflared tunnel run --token-file /etc/cloudflared/dream-token`，启动后应有 4 条连接注册（connIndex 0–3）。

3. 在隧道 Public Hostname 添加 `dream.pum.org.cn → http://127.0.0.1:8787`。Cloudflare 会自动创建 CNAME；没有这条 ingress，connector 会返回 503。

4. 验证：

   ```bash
   curl -4 -s https://dream.pum.org.cn/api/v1/health
   ```

本机若没有 IPv6 路由，`curl` 默认可能先走 IPv6 超时，加 `-4` 或 `--ipv4` 即可。

> 备选：用 `cloudflared tunnel login` + `tunnel create` 建本地托管隧道，再写 `/etc/cloudflared/dream.yml` 的 ingress 并用 `tunnel route dns` 建 CNAME；本仓库的固定域名采用上面的 token-file 方式，保持与博客一致。

## 运维

```bash
systemctl status dream-server
journalctl -u dream-server -f
curl -s http://127.0.0.1:8787/api/v1/health
```

## 访问方式（当前）

服务只绑定本机回环地址，公网通过 Cloudflare 命名隧道 `dream-named-tunnel.service` 暴露 HTTPS：`https://dream.pum.org.cn`。所有 `/api/v1/*`（除 health/models）要求登录 Bearer Token。

```bash
# 本机调试
ssh -N -L 8787:127.0.0.1:8787 root@47.117.51.245
curl http://127.0.0.1:8787/api/v1/health
```

早期试用的 trycloudflare quick tunnel 已停用（`dream-tunnel.service` 已移除）。若以后改挂 nginx，注意：`/api/v1/chat` 是 SSE，需要 `proxy_buffering off`、`proxy_read_timeout` 至少 300s，并保留 `X-Request-Id` 透传。

## 独立应用与账号（2026-11-19）

- 服务端与 Web 合并为单一进程：`server.mjs` 同时提供 `/api/v1/*` 与 `web/` 静态文件，`DREAM_WEB_DIR=/srv/blog/dream/web`。
- 账号：SQLite（`DREAM_DB_PATH=/srv/blog/dream/data/dream.db`），scrypt 密码哈希，`sessions` 表保存 token 哈希；`/api/v1/chat` 强制 Bearer 鉴权。
- systemd：`dream-server.service` 增加 `ReadWritePaths=/srv/blog/dream/data`（`ProtectSystem=strict` 下允许写库）；`dream-named-tunnel.service` 用 token-file 运行 `cloudflared tunnel run`。
- 当前公网入口（固定域名）：https://dream.pum.org.cn 。quick tunnel 已停用。
