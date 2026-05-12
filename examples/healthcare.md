# 示例走例：医院收银系统

这是 doc2test skill 在一个具体行业项目里的完整配置示例，便于新项目同学对照参考。

> 项目背景：访日外国患者使用的医院收银系统，使用信用卡 Auth/Capture 完成预授权 → 扣款 → 自动退差 / 追加扣款的闭环。涉及 4 个核心角色和 10+ 种受诊状态。

## `.skill-config.yaml`

```yaml
prd_path: docs/产品技术文档.md
app_url: http://localhost:3000

auth_modes:
  patient:
    login_url: /patient/login
  staff:
    login_url: /login

module_domain_mapping:
  Appointment: appointment
  Consultation: consultation
  Payment: payment
  User: user
  Card: card

options:
  default_locale: ja
  ai_run_timeout_per_case_s: 180
  bring_to_front_on_tab_switch: true
```

## 模块清单（test-outline.md 第 3 节）

| 模块代号 | 模块名 | 一句话职责 | 预估用例数 |
|---|---|---|---|
| APT | Appointment | 患者预约提交与院方确认 | 12 |
| CONS | Consultation | 受诊单状态机与费用录入（10 种状态） | 18 |
| PAY | Payment | 信用卡 Auth/Capture/Refund/Revoke/AddOn | 14 |
| USR | User | 患者注册、登录、账号设置 | 8 |
| CARD | Card | 信用卡绑定、主卡切换 | 6 |

## 典型用例（test-cases.md 节选）

| 用例ID | 用例名称 | 用例类型 | 所属模块 | 前置条件 | 步骤描述 | 预期结果 | 标签 | 优先级 |
|---|---|---|---|---|---|---|---|---|
| APT_001 | 患者提交预约-正常流程 | 功能 | APT | 已登录患者；已绑卡 | 1. 访问 /patient/appointment<br>2. 备注填写「interpreter needed」<br>3. 点击「提出」 | 1. 跳转 /patient/history<br>2. 列表首条状态「確認待ち」 | smoke | 高 |
| CONS_005 | 概算费 ≤ 实际费-自动退款 | 功能 | CONS | 状态 `treatment_pending`；Auth=10000 | 1. 员工录入实际费 7000<br>2. 等待 Capture 异步通知<br>3. 等待自动 Refund | 1. Capture 成功，扣 10000<br>2. 自动 Refund 3000<br>3. 受诊状态 `payment_success` | payment, state-machine | 高 |
| PAY_011 | Auth 异步通知失败-状态回退 | 异常 | PAY | 状态 `consent_pending`；Auth 中 | 1. 模拟收银台 PAY_RESULT FAILURE | 1. 受诊状态 `estimate_failed`<br>2. `failure_reason` 写入失败原因 | error, async-callback | 高 |

## 重点风险（test-outline.md 第 4 节）

- **状态机错配**：受诊单 10 种状态、20+ 条流转边，错配会导致资损（双重扣款 / 漏退款）
- **异步通知幂等**：Auth/Capture/Refund 全部依赖收银台 webhook，重放和乱序必须可防
- **PCI 合规**：本系统不存卡号 / 有效期，只存 token；测试断言不能依赖本地卡数据

## Pairwise 示例（test-cases.md 节选）

CONS_007 多参数组合：受诊状态 × 是否绑卡 × 实际费方向

| 用例ID | 受诊状态 | 卡状态 | 实际 vs 概算 | 预期 |
|---|---|---|---|---|
| CONS_007-1 | treatment_pending | 主卡有效 | 实际 = 概算 | Capture 成功 → `payment_success`，无差额 |
| CONS_007-2 | treatment_pending | 主卡有效 | 实际 < 概算 | Capture 成功 → 自动 Refund → `payment_success` |
| CONS_007-3 | treatment_pending | 主卡有效 | 实际 > 概算 | Capture 成功 → 等待员工 AddOn |
| CONS_007-4 | treatment_pending | 主卡失效 | 实际 < 概算 | AddOn 失败提示，Refund 仍执行 |

---

## 对照点

| 通用 skill 默认（电商） | 本示例（医院） |
|---|---|
| `auth_modes: customer / seller / admin` | `patient / staff` |
| 模块前缀 `USR / PROD / ORD / PAY` | `APT / CONS / PAY / USR / CARD` |
| 主测语言 `zh` | `ja` |
| 单用例 timeout 180s | 180s（沿用，状态机用例略紧） |
| Playwright domain `order / product / ...` | `appointment / consultation / payment / ...` |
