# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-05-12

### Added

- 首次发布 `doc2test` Skill，支持 Claude Code 与 Codex CLI。
- 四阶段工作流：设计 / 执行 / 提炼 / 回归 + 报告。
- 内置用例设计规范 (`role.md`)：等价类、边界值、异常、状态流转覆盖目标。
- 模板套件：`.skill-config.yaml`、测试大纲 / 用例、Playwright 配置与脚本骨架、`meta.schema.json`、统一 HTML 报告骨架。
- 真实项目走例：医院收银系统 (`examples/healthcare.md`)。
- 项目级配置入口 `test/.skill-config.yaml`：统一管理 PRD 路径、应用 URL、登录模式、模块映射。
- 版本隔离：所有版本相关产物落在 `test/{version}/`，Playwright 套件跨版本共享。
