---
name: bootstrap-context
description: 初始化和维护 `.agent-context/` 里的知识类文件（结构、命令、配置、约定、决策）；状态类用 `update-progress`。
---

# Bootstrap Project Context

`.agent-context/` 的作用与归属见 `Agentic 方法论` 的 Project Memory。本 skill 负责**知识类**文件；状态类（`PROGRESS.md` + `worklog/`）归 `update-progress`。

## When to use

- 首次：`.agent-context/` 缺失且属于实质性工作（判定见 `Agentic 方法论` Startup）
- 后续：结构、依赖、命令、配置、约定、决策或教训发生实质变化后
- 用户显式要求

## Instructions

1. 只读与任务相关的 `README`、manifest、env 示例、规则与宿主指令，不扫全仓；有 git 时用 diff/status 定位变化，无 git 时比较相关文件并标注不确定性。
2. 改前先读，局部更新并保留仍有效的人工内容；只对实际检查过的路径声称已验证。结构变化时同步 `ARCHITECTURE.md` 的 `verified against`（commit 加已核对的 worktree，或 `(no git)`）和覆盖路径。
3. 自行从源码与实测提取事实，不向用户索要可自行查明的信息。只记录下次会话仍有用的内容；所有文件可选，不留空占位。
4. 写教训时区分已核实的失误、可能原因与候选改进，并写明适用范围；单个案例、一次复盘或他人意见不直接升级为跨任务规则。已记录的教训被证伪时就地更正，不叠加相反的两条。
5. 若用户意图与 `PROGRESS.md` 中对应目标不一致，加载 `update-progress` 处理；仅切换焦点不判为目标漂移，本 skill 不直接改状态文件。
6. 完成后简短报告变更文件、关键事实与未知项。

文件归属沿用 `Agentic 方法论` 的 Project Memory 表；知识文件补充可复用事实，不复制地图或日志。

用真实日期；服务未来的 agent，不写全面文档。
