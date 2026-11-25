# 14 · AI Ops 飞轮与测试反馈闭环 · 分阶段实现工单

> 日期：2026-11-25  
> 归属：跨仓协作（**前端工作台 UI 在 `Gym_coach_Admin` `/ai-ops`**；**API / 数据库 / H5 测试开关 / `eval/` 在 `Gym_coach`**）。  
> 关联文档：[`01-总体架构与功能方案.md`](./01-总体架构与功能方案.md)（模块 5：AI Ops）、`Gym_coach/docs/15-计划跟练与教练演进-分阶段实施工单.md`。

---

## 0. 核心定位（先对齐，不做重型中台）

1. **绝不让用户标注“未命中”**：未命中是系统（`knowledge.py` / `DebugTrace`）**自动记录**的；人或 LLM 在后台查看未命中记录，核心只回答一件事：
   - **动作库里实际有这个动作吗？**
     - **有，只是没认出来** → 看清为什么没命中（缺口语别名 / 词根规则漏了）→ 绑定到 `exercise_aliases` 并**热重载内存索引**，立刻生效；
     - **库里真没有** → 跳转 `/exercises` 新建动作 SKU（或去 `/studio` 拆视频补齐）。
2. **不拆独立服务**：H5 与 Admin 继续共用同一个 `Gym_coach/api`（FastAPI）和数据库。
3. **当下最高优**：在正式放量前，先打通**开发者/内测人员的「测试反馈开关 → 点踩攒 Badcase → 导出多轮/单轮 `eval` 草稿」**，用真实测试对话扩充多轮长对话与多意图回归集；Admin `/ai-ops` 随后承接聚合与处理。

---

## 总览：三阶段拆分

| Phase | 所在仓库 | 核心产出 | 优先级 |
|---|---|---|---|
| **Phase A** | `Gym_coach`（API + H5 + `eval/`） | `ChatTurn.trace_id` 持久化、H5 测试反馈开关、`export_feedback_inbox.py` 支持多轮导出 | **P0（最急，先做）** |
| **Phase B** | `Gym_coach` API + `Gym_coach_Admin` `/ai-ops` | `/api/admin/ai-ops/*` 接口、未命中识别与处理（绑别名+热重载 / 补新动作）、差评 AI 归因与导出 | **P1（核心后台闭环）** |
| **Phase C** | `Gym_coach` API + `Gym_coach_Admin` | 推荐计划 0 命中缺口榜、工坊纠错词反哺别名表 | **P2（按需扩展）** |

---

## Phase A：轻量测试反馈闭环（先让自己测得顺手）

**目标**：解决当前「刷新页面后点踩按钮消失」「正式用户与内测反馈开关未隔离」「多轮长对话点踩难以导出进 `cases-long.yaml`」三个卡点。

### A.1 任务清单（全部在 `Gym_coach` 仓）

1. **会话轮次持久化 `trace_id`（解决刷新后按钮消失）**
   - 文件：`api/app/models.py`、`api/app/db.py`、`api/app/brain/memory_context.py`、`api/app/brain/pipeline.py`、`web/src/types.ts`、`web/src/pages/CoachPage.tsx`
   - 改动：
     - `ChatTurn` 增加可空列 `trace_id: Optional[int] = Field(default=None, index=True)`，`db.py` `_ensure_columns` 自动补列。
     - `pipeline.py` 在 `save_exchange` 时把刚刚生成的 `trace.id` 写入对应 assistant `ChatTurn.trace_id`。
     - `memory_context.py` `load_conversation_messages` 返回每条 assistant 消息时带上 `trace_id`。
     - `CoachPage.tsx` 的 `fromApiMessages` 透传 `trace_id` 到 `m.traceId`（并兼容仅用 `turnId` 回退）。
   - 效果：刷新页面或切 Tab 回来后，历史每条回复依然可以点 👍/👎，且提交的 `FeedbackEvent` 拥有完整 `DebugTrace` 快照。

2. **H5「测试反馈开关」与标签补齐**
   - 文件：`web/src/pages/CoachPage.tsx`、`web/src/components/MessageFeedback.tsx`、`web/src/pages/ProfileSettingsPage.tsx`（或 `DebugPage.tsx`）、`api/app/schemas.py`
   - 改动：
     - 前端增加 `localStorage` 开关（如 `gym_coach_test_feedback`，可在资料设置页或调试页一键开/关；开关开启时才在教练气泡下渲染 `MessageFeedback` 与 `调试轨迹 #traceId`）。
     - `FEEDBACK_TAGS`（`api/app/schemas.py`）与 `DOWN_TAGS`（`MessageFeedback.tsx`）可按需补充更贴合内测的标签，例如 `multi_turn_lost`（多轮忘上下文）、`multi_intent_miss`（多意图漏了），保持向后兼容。

3. **导出脚本支持多轮长对话草稿**
   - 文件：`api/scripts/export_feedback_inbox.py`
   - 改动：
     - 新增 `--format auto|single|thread`（默认 `auto`）：
       - 当 `snapshot.history` 仅单轮或为空时，沿用现有 `vars.question` 单轮格式（进 `cases.yaml`）；
       - 当同一 `conversation_id` 存在 ≥ 2 轮用户对话时，额外/切换生成 `vars.thread.turns` 多轮结构（对齐 `eval/cases-long.yaml` 与 `eval/README.md` 契约），方便直接人工核对后晋级到多轮评测集。

### A.2 Phase A 验收与测试

- [ ] **后端单测 & 建表验证**：
  ```powershell
  cd e:\项目文件\gym-coach\Gym_coach\api
  .\.venv\Scripts\python.exe -m pytest tests/test_feedback.py tests/test_chat_graph.py tests/test_memory_eval.py
  .\.venv\Scripts\python.exe -c "from app.db import init_db; init_db(); from sqlalchemy import inspect; from app.db import engine; print([c['name'] for c in inspect(engine).get_columns('chatturn')])"
  ```
  确认 `chatturn` 表存在 `trace_id` 列。
- [ ] **前端构建**：
  ```powershell
  cd e:\项目文件\gym-coach\Gym_coach\web
  npm run build
  ```
- [ ] **人工走查**：
  1. 打开测试反馈开关，在教练页连续聊 3 轮（包含改草稿或切意图）→ **刷新页面** → 确认第 1~3 轮气泡下仍然显示 👍/👎 与 `#traceId`。
  2. 在第 3 轮点 👎 选原因提交 → 运行 `.\.venv\Scripts\python.exe scripts/export_feedback_inbox.py --format auto`，检查 `eval/inbox/` 生成的 YAML 已带出完整多轮上下文草稿。
  3. 关闭测试反馈开关 → 教练页气泡下隐藏 👍/👎 与调试轨迹号，恢复干净 C 端外观。

---

## Phase B：Admin `/ai-ops` 工作台（未命中处理 + 差评归因）

**目标**：把 `Gym_coach_Admin` 现有的 `/ai-ops` 占位页做实，形成「系统自动记未命中 → 人/LLM 判断库里有还是没有 → 绑别名热重载或补新动作」和「后台审差评 → 归因 → 进 `eval/inbox`」闭环。

### B.1 后端设计与接口（在 `Gym_coach/api`）

1. **轻量状态表**：`api/app/models.py`
   - 新增 `AiOpsMissState`（`__tablename__ = "ai_ops_miss_states"`）：
     - `id`: 主键
     - `norm_query`: `str`（唯一索引，归一化后的未命中词/问句片段）
     - `status`: `str`（`pending | bound | created_sku | ignored`）
     - `bound_exercise_id`: `Optional[str]`
     - `note`: `Optional[str]`（记录未命中原因或处理备注）
     - `updated_at`: `NaiveDatetime`
   - `FeedbackEvent` 可选补充 `ai_diagnosis: Optional[dict[str, Any]]`（JSON，缓存 AI 归因结果）。

2. **聚合与热重载服务**：新增 `api/app/services/ai_ops_service.py`
   - **未命中聚合（`list_missed_queries`）**：
     - 扫描最近 N 条 `DebugTrace`（筛选 `payload.grounding.kb.queried == True` 且 `kb.hit == False`，或 `kb.reason in ("miss", "below_miss")`，或触发 `branch in ("search", "ask")`）。
     - 按归一化查询词分组统计：出现次数、最近一次时间、示例原句（最多 3 条）、系统当时给的 `near_miss` 候选列表、`DebugTrace.id` 列表；过滤掉 `AiOpsMissState` 中已标记 `bound / created_sku / ignored` 的项（支持切 tab 查看已处理）。
   - **AI 辅助判别「库里有还是没有」（`diagnose_missed_query`）**：
     - 取该未命中词 + 示例问句 + 动作库候选（`exercises_catalog` 模糊检索 Top-10），调 LLM 返回结构化建议：
       - `verdict`: `"has_match" | "missing_exercise" | "non_exercise"`
       - `reason`: 一句话解释为什么没命中（如「用户口语简称『蝴蝶机』，库内叫『固定器械坐姿夹胸』」或「属于肌群/器材杂谈，无需建动作」）
       - `suggested_candidates`: Top-3 匹配动作（`exercise_id`, `name_zh`, `confidence`）
       - `suggested_alias`: 建议写入 `exercise_aliases` 的规范别名
   - **绑定别名并热重载（`bind_miss_to_alias`）**：
     - 校验目标 `Exercise` 存在；若 `ExerciseAlias` 未存在则插入 `ExerciseAlias(exercise_id=..., alias=..., status="published")`；
     - **必须调用 `exercises_catalog.reload_all()`**（同时刷新排课目录与 `knowledge.py` 问答索引），保证 H5 即刻生效；
     - 更新 `AiOpsMissState` 为 `status="bound"`, `bound_exercise_id=...`。
   - **补新动作 / 忽略（`mark_miss_created` / `ignore_miss`）**：
     - 运营在后台新建完动作 SKU 后回标 `created_sku`（或在新动作里把该词作为别名一并写入并 `reload_all()`）；噪音问法标 `ignored`。
   - **差评收件箱与 AI 归因（`list_feedbacks` / `diagnose_feedback` / `export_feedback_case` / `discard_feedback`）**：
     - 复用 `export_feedback_inbox._case_doc` 生成标准 YAML；
     - `diagnose_feedback` 把 `FeedbackEvent.snapshot` 送给 LLM，返回 `root_cause`（分流错 / 缺别名 / 排课约束遗漏 / 上下文丢失）、`fix_hint` 与建议的 `assert` 草稿。

3. **后台路由**：新增 `api/app/routers/admin_ai_ops.py` 并挂载到 `main.py`（prefix `/api/admin/ai-ops`，均加 `Depends(require_admin)`）：
   - `GET /api/admin/ai-ops/misses`
   - `POST /api/admin/ai-ops/misses/diagnose`
   - `POST /api/admin/ai-ops/misses/bind-alias`
   - `POST /api/admin/ai-ops/misses/resolve`（支持 `created_sku` / `ignored`）
   - `GET /api/admin/ai-ops/feedbacks`
   - `POST /api/admin/ai-ops/feedbacks/{id}/diagnose`
   - `POST /api/admin/ai-ops/feedbacks/{id}/export`（返回 YAML 内容并支持可选写入 `eval/inbox/`，更新 `export_status="exported"`）
   - `POST /api/admin/ai-ops/feedbacks/{id}/discard`（更新 `export_status="discarded"`）

### B.2 Admin 前端界面（在 `Gym_coach_Admin`）

- 文件：新增 `src/pages/AiOpsPage.tsx`（及 `.css`）、更新 `src/App.tsx`（替换 `/ai-ops` 占位页）、`src/pages/DashboardPage.tsx`（如有概览计数入口）。
- 布局（遵循 `04-后台UI规范与AI实施手册.md` Forge 风格）：
  - 顶部两枚主 Tab：**「未命中动作池」** 与 **「差评与评测收件箱」**。
  - **Tab 1（未命中动作池）**：
    - 左侧列表：未命中词、提问次数、最近一次原句、状态筛选（待处理 / 已处理）。
    - 右侧处理台：
      1. 展示原句与系统当时的 `near_miss`；
      2. 「✨ AI 帮我看库里有没有」按钮 → 展示 `verdict` 结论 + 原因 + Top-3 候选动作；
      3. 动作区：搜库选择或直接点候选「绑定为别名（热生效）」 / 「库里没有，去新建 SKU」（跳转或弹窗 `CreateExerciseModal` 并自动带入中文名初稿） / 「忽略」。
  - **Tab 2（差评与评测收件箱）**：
    - 列表：时间、差评标签、用户原句、导出状态（`pending | exported | discarded`）。
    - 详情抽屉/右栏：完整对话历史与当时意图/路由/草稿快照 + 「✨ AI 诊断归因」 + 「导出/复制 Eval YAML」 + 「忽略」。

### B.3 Phase B 验收与测试

- [ ] **后端单测**（新增 `api/tests/test_admin_ai_ops.py`）：
  - 模拟写入一条 `DebugTrace` 未命中 → `GET /api/admin/ai-ops/misses` 能聚出；
  - 调 `bind-alias` 后，验证 `ExerciseAlias` 落库且立即调 `knowledge.ground_question(alias)` **必须命中**（验证热重载生效）；
  - 模拟 `FeedbackEvent` 点踩 → 调 `export` 与 `discard` 状态流转正确。
  ```powershell
  cd e:\项目文件\gym-coach\Gym_coach\api
  .\.venv\Scripts\python.exe -m pytest tests/test_admin_ai_ops.py tests/test_feedback.py tests/test_knowledge.py
  ```
- [ ] **Admin 前端构建**：
  ```powershell
  cd e:\项目文件\gym-coach-admin\Gym_coach_Admin
  npm run build
  ```
- [ ] **联调走查**：
  1. 在 H5 教练页故意问一个库里已有动作的生僻叫法（触发未命中）→ 打开 Admin `/ai-ops` 能看到该词 → 点 AI 判断 → 绑定别名 → 回到 H5 再问同一句，**不重启 API 直接命中该动作卡片**。
  2. 在 Admin `/ai-ops` 对一条确实不在库里的动作点「去新建 SKU」→ 新建完成后自动标为已处理。

---

## Phase C：内容缺口与工坊反哺（可选深化）

1. **计划推荐 0 命中缺口榜**（依赖 `Gym_coach/docs/15` Phase 1 上线）：
   - 聚合 `plan_kind == "recommend_plan"` 但命中 0 套模板的 `DebugTrace`，在 Admin `/ai-ops` 新增提示条「近期高频求计划但库空的类型」（如居家 / 产后 / 新手三分化），直接链到 `/studio` 引导选题。
2. **工坊人工纠错顺手沉淀别名**：
   - Admin `/studio` 拆解视频绑定动作时，若人工选中的标准 SKU 与字幕口播词不一致，提供「同时将该口播词加为别名」勾选框，落库并热重载。

---

## 收尾要求

- 每完成一个 Phase，必须同步更新 `Gym_coach/docs/项目地图.md`（§6 数据口径 / §7 接口目录 / §8 耦合表）与本仓 `docs/README.md`。
