# WeCom Visitor Approval · 企业微信访客审批系统

基于企业微信原生审批流程的访客管理系统。校外访客通过 H5 填写申请，校内人员在企业微信审批；系统同步审批结果，提供短信通知、申请查询、临时入校卡和管理后台。

适用于校园、园区等已有企业微信组织与审批流程的场景。项目以企业微信审批单为状态依据，审批通过才签发入校核验码。

## 功能

- **公开 H5 申请**：被访人姓名与登记手机号核对，1–20 人访客明细、日期时段、车牌和可选邮箱。
- **提交前手机验证**：第一位访客完成 6 位短信验证码验证，绑定访客资料与会话；额度持久化。
- **企业微信原生审批**：使用模板审批节点；可发现同模板的原生申请，按提交时间增量同步。
- **结果通知**：审批通过后生成 4 位核验码；短信、邮件、企业微信消息分别持久记录状态。
- **申请查询**：校内被访者姓名、访客姓名、访客手机号、入校日期四项联合匹配，支持查询审批中申请。
- **临时入校卡**：登记手机号与核验码核验，实时复查审批与预约时段；查询结果可直接打开卡片。
- **管理后台**：统计大屏、多条件记录查询、审批及通知日志、独立免费车辆登记。
- **隐私保护**：身份证在本地持久化前使用 AES-256-GCM 加密；手机号和姓名业务索引仍有明文。
- **可选车辆集成**：普通车辆及免费登记适配器，记录请求不确定状态，避免盲目重发。

目前使用接口轮询，默认约每 60 秒同步，并非企业微信事件回调。部署为单进程，登录和核验会话保存在内存，业务台账及短信额度持久保存。

## 快速开始

要求 Node.js **22.13 或以上**，推荐受支持的 Node.js LTS。无第三方 Node.js 运行时依赖；邮件选择 SMTP 传输时另需 Python 3。

```sh
git clone https://github.com/chenxianlong/wecom-visitor-approval.git
cd wecom-visitor-approval
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Windows PowerShell 可用 `Copy-Item .env.example .env`。将生成的随机值填写到 `GATE_PASS_SECRET`，再配置企业微信及手机号验证所需的短信参数，然后运行：

```sh
npm start
```

打开 `http://localhost:3000`。空配置可启动页面，但无法进行被访人核对、验证码发送或审批提交。核心业务必须连接你自己的企业微信组织与审批模板。

```sh
npm test
```

自动测试使用模拟企业微信、短信、邮件及车辆接口；不会创建真实审批或发送真实通知。测试中的姓名、手机号和身份证是固定校验样例，不是运行数据。

## 企业微信与审批模板

配置 `WECOM_CORP_ID`、`WECOM_AGENT_ID`、`WECOM_SECRET`、`WECOM_TEMPLATE_ID`，并在企业微信中设置应用可见范围、服务器可信 IP 以及通讯录、审批和消息权限。被访人需能发起该模板审批。

模板需要包含可识别的字段：`访问类型`（单选）、`入校事由`、`入校日期`、`入校时间段`（DateRange），访客明细中的 `姓名`、`身份证号码`、`手机号码`，以及可选 `入校车牌号码` 和 `结果通知邮箱`。适配逻辑位于 `approval.mjs` 和 `template-discovery.mjs`，不同组织的字段名称、控件类型应先用模拟数据验证。未知必填控件会阻止提交，避免丢字段。

```sh
node inspect-template.mjs
```

该命令仅读取模板，结果存入已忽略的 `private/template.json`，不要公开模板快照。它不创建审批。上线前在自己的测试模板完成申请、人工审批、查询和卡片核验。

被访人核对要求姓名、手机号映射身份及账号激活状态匹配，姓名含 ASCII `-` 会拒绝。部门用于展示，没有“必须属于某部门”的默认准入条件；可选 `TEMPLATE_SCOPE_FILE` 另行约束发起范围。

## 主要配置

| 配置 | 用途 |
| --- | --- |
| `BASE_URL` | 对外访问地址，影响同源检查及通知链接；生产必须使用实际 HTTPS 地址 |
| `BIND_HOST` / `PORT` | 默认监听 `127.0.0.1:3000`，由反向代理访问 |
| `DATA_DIR` | SQLite、加密身份密钥及各渠道 JSON 台账位置 |
| `GATE_PASS_SECRET` | 64 位十六进制随机密钥，用于核验凭证、手机号验证等；持久保存 |
| `PUBLIC_FORM_ENABLED` | `true` 允许公开填报；`false` 配合 `VISITOR_INVITE_TOKEN` 邀请链接 |
| `PHONE_SMS_TEMPLATE_CODE` | 提交前 6 位验证码模板，变量仅 `code`；公开 H5 的必要配置 |
| `ALIYUN_SMS_ACCESS_KEY_ID` / `ALIYUN_SMS_ACCESS_KEY_SECRET` / `ALIYUN_SMS_SIGN_NAME` | 阿里云短信服务端凭证与已审核签名 |
| `ALIYUN_SMS_ENABLED` / `ALIYUN_SMS_TEMPLATE_CODE` | 可选审批通过通知；模板变量 `visitor_name`、`request_number`、`verify_code` |
| `PHONE_SMS_DAILY_LIMIT` | 全站滚动 24 小时验证码额度，默认 1000；另有手机、会话和 IP 限额 |
| `AGENTMAIL_INBOX` / `AGENTMAIL_API_KEY` | 可选邮件；申请人未填邮箱时不发邮件 |
| `AGENTMAIL_TRANSPORT` / `PYTHON_PATH` | 默认 `https`；选 `smtp` 时需要 Python 3 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 管理后台账号；不配置则关闭登录能力 |
| `TEMPLATE_DISCOVERY_ENABLED` | 发现同模板原生审批；首次启用记录起点，不自动导入更早历史单 |
| `TRUSTED_PROXY_IP` | 唯一受信代理 IP；只能填写实际直接代理地址 |
| `CAR_GATE_ENABLED` / `CAR_GATE_TOKEN` / `CAR_GATE_URL` | 可选普通车辆集成，默认关闭；地址不内置 |
| `CAR_FREE_URL` | 管理员手动免费登记地址；配置和审批校验通过后才会调用 |

提交前验证码与审批结果短信相互独立：`ALIYUN_SMS_ENABLED=false` 只关闭结果短信，不取消公开 H5 的手机验证。

车辆集成为通用示例适配器，不包含任何学校实际停车系统接口、私有路径或参数协议。部署方须在 `car-gate.mjs` 与 `free-vehicles.mjs` 中适配自己的接口合同，再配置地址与凭证。示例采用通用字段；出校日期为入校日期加一个自然日，HTTP 成功不代表车辆授权成功。

## 页面与代码

| 入口 | 功能 |
| --- | --- |
| `/` | 访客申请 |
| `/query` | 四条件查询 |
| `/verify` | 手机号与核验码、临时入校卡 |
| `/result#token=…` | 内部结果消息的签名专属链接 |
| `/admin/dashboard` | 管理大屏 |
| `/admin/records` | 记录查询 |
| `/admin/free-vehicles` | 免费车辆登记与操作日志 |

服务入口 `server.mjs`，字段及提交适配 `approval.mjs`，被访人核对 `host.mjs`，通知编排 `notifications.mjs`，原生审批发现 `template-discovery.mjs`，查询 `approval-query.mjs`，核验卡 `gate-pass.mjs`，后台日志 `audit-store.mjs`。旧 `host-review.mjs` 保留历史逻辑测试，公开预确认路由已停用。

## 部署、数据和安全

参见 [部署说明](deploy/DEPLOYMENT.md) 与 [安全说明](SECURITY.md)。本仓库为脱敏后的独立版本，使用通用图标；未包含原部署凭证、学校标识、真实访问域名、内网拓扑、生产数据、宣传附件或旧 Git 历史。

临时入校卡供门岗人工核对实时页面与本人有效证件，不直接控制人行道闸，也不能保证防截图。数据保留周期、隐私告知和访问权限应由部署方结合实际场景配置。

## License

[MIT](LICENSE)。
