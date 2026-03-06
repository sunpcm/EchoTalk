# AI 编码助手 (Claude Code) 协作开发与重构通用规范

本指南旨在规范团队与 AI 编码助手（如 Claude Code, Cursor 等）的协作流程。遵循本规范可最大程度降低 AI 产生的“幻觉代码”，确保项目在演进或重构过程中架构清晰、变更可控。

## 1. 核心协作原则 (Core Principles)

在使用 Claude Code 进行任何模块重构或新功能开发时，必须遵循以下“四步走”原则：

1. **谋而后动 (Plan Before Action)**：
   **严禁**让 AI 在没有明确设计思路的情况下直接改写大量代码。要求 AI 先阅读规划，输出方案设计（类图、接口、受影响的文件列表），经开发者确认后再执行。
2. **基建先行 (Refactor Before Feature)**：
   遵循“先重构底座，再添加特性”的模式。先通过重构（提取公共接口、解耦依赖）搭建好可扩展的架构，最后再引入新的业务逻辑或配置项。
3. **小步快跑 (Small, Verifiable Steps)**：
   每次 Prompt 指令只要求 AI 处理单一职责或单个模块。完成一个重构点后，立即要求 AI 运行检查（如 Linter、Type Check 或单测），确保无误后再进入下一步。
4. **敬畏现有逻辑 (Respect Existing Behavior)**：
   重构过程必须做到“对内优化结构，对外接口稳定”。不可随意修改周边模块和第三方依赖的版本或核心工作流，除非任务明确要求。

## 2. 知识库与文档矩阵与同步机制

AI 编码助手由于上下文窗口限制和跨会话遗忘，极度依赖项目内结构化的文档。在发起任务前，请开发者确保以下文档处于最新状态：

| 文档名称                  | 定位与内容要求                                                                                                   | AI 读取的时机                  |
| :------------------------ | :--------------------------------------------------------------------------------------------------------------- | :----------------------------- |
| `AI_INSTRUCTIONS.md`      | **大宪章 (Global Rules)**：记录项目的编码规范、库版本偏好、命名约定（如后端强制 Type Hint，前端全量 TS）。       | 每个新会话初始化时。           |
| `DEVELOPMENT_PLAN.md`     | **项目里程碑 (Milestones)**：记录已完成的阶段 (Done) 和当前需要执行的具体阶段 (Current Phase)。                  | 每次需要明确当前开发进度时。   |
| `docs/技术方案设计.md`    | **架构与设计意图 (Architecture)**：针对当前阶段模块，提前写明你期望的架构模式、数据流转逻辑或组件关系。          | 开始复杂的重构或新功能设计时。 |
| `docs/相关的Phase文档.md` | **具体执行手册 (Execution Book)**：如果当前迭代内容较多，创建子文档列出需要修改的清单、特定 API 签名和验收标准。 | 执行具体特性开发的过程中。     |

## 3. 通用架构演进与重构规范

要求 Claude Code 执行底层重构时，需要其遵循以下通用架构演进目标：

- **依赖倒置与抽象 (Abstraction & Decoupling)**：面向接口（Interface/Base Class）编程，分离业务核心逻辑与外部依赖（如数据库、第三方 API、系统环境）。
- **消除硬编码 (Remove Hardcoding)**：将代码中的魔法字符串、写死的路径/配置项抽取为常量、配置文件或允许动态注入的数据结构。
- **副作用管理 (Side-effect Management)**：将涉及 I/O、全局状态修改的模块独立拆分，保证核心转换逻辑推向纯函数，以利于后续测试和扩展。
- **渐进式类型完善 (Typing Enhancements)**：在重构过程中顺手补全缺失的类型注解，为代码加上更严格的安全网。

## 4. 标准高效 Prompt 模板库 (Prompt Best Practices)

将以下模板复制并调整后喂给 Claude Code，以启动标准工作流：

### 4.1 阶段零：对齐上下文 (Context Initialization)

```text
Please read the following documents first to understand our project context, coding standards, and current development phase:
1. `DEVELOPMENT_PLAN.md`
2. `AI_INSTRUCTIONS.md`
3. `docs/技术方案设计.md` relevant to our current phase.
4. `docs/CLAUDE_CODE_REFACTOR_GUIDE.md` (This file, for workflow rules).

Acknowledge you understand the constraints and the current goal. Reply "Understood, ready to plan" without suggesting code changes yet.
```

### 4.2 阶段一：方案设计与提议 (Design & Propose)

```text
Our current task is Phase [X.X] from `DEVELOPMENT_PLAN.md`.
Please analyze the relevant files in the `[Target Directory/Module]` module.
Propose a refactoring/implementation plan that aligns with our decoupling and abstraction goals.
DO NOT WRITE FULL CODE OR MODIFY FILES YET.
Outline your plan step-by-step, specify the components/interfaces you will abstract, and list the files you intend to modify.
```

### 4.3 阶段二：受控执行单一任务 (Execute & Verify)

```text
The proposed architecture looks good. Please execute Step 1 of your plan: [Specific Task Description, e.g., create the Base Interface].
Ensure you maintain the existing public API signatures so we don't break dependencies.
After making the changes, run the project's linter and type checker to verify your modifications before we proceed to Step 2.
```
