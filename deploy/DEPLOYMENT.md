# 通用部署

1. 安装 Node.js >=22.13，将源代码放到服务目录，例如 `/opt/wecom-visitor-approval`。
2. 创建专用运行用户 `visitor-approval`，复制 `.env.example` 为 `.env`，设置企业微信、短信、核验密钥和实际 HTTPS `BASE_URL`。配置文件仅允许运行用户读取。
3. 将 `DATA_DIR` 设置为独立持久目录，例如 `/var/lib/visitor-approval`，由运行用户独占写入；推荐目录权限 0700、文件权限 0600。
4. 用 HTTPS 反向代理访问 `127.0.0.1:3000`，设置 `TRUSTED_PROXY_IP=127.0.0.1`（仅适用于同机 IPv4 代理）。代理必须覆盖客户端传来的真实 IP 头；应用端口不对公网开放。
5. 为验证码、身份核对、提交及查询设置网关限流；共享出口环境应按实际负载验证阈值。请求正文上限与应用保持 32 KiB，禁止自动重试有副作用的请求。
6. 使用下面的 systemd 示例并按实际路径调整；使用自己的测试审批模板完成验收后再开放服务。

## Nginx 代理示例

以下片段用于自行配置好证书的 HTTPS `server` 中；域名和证书由部署方配置。本仓库不附带任何真实部署拓扑。

```nginx
client_max_body_size 32k;
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_next_upstream off;
}
```

Nginx 默认访问日志可能记录查询参数。生产应定义仅记录方法、`$uri`、状态等必要信息的日志格式，不记录参数、正文、Cookie 和凭证。

## 升级与备份

- 升级前运行测试并备份代码和一致性数据，等待 `sending` 任务结束后按需重启。
- 只替换代码，不覆盖 `.env`、数据目录、密钥、发现游标及各渠道发送台账。
- SQLite 在线备份使用 backup API；不要只复制活动主库而遗漏 WAL。也可受控停服后备份完整数据目录。
- 密钥与数据分开保存，定期验证恢复；通知重发必须逐条核对，不因回滚代码倒退业务台账。
- `migrate-identity-privacy.mjs` 是显式历史数据维护工具，不应随普通部署自动执行。
- 开源版本使用独立的加密格式标识，不应直接替换既有私有生产项目或导入其加密台账；迁移需另行设计并校验。
