# GymCoach Admin · UI 规范与 AI 实施手册

> 状态：视觉方向已确认。  
> 主方向：Forge / 锻造间。  
> 预览入口：`preview/index.html`、`preview/login.html`、`preview/workbench.html`。

## 1. 产品气质

后台是运动内容工程控制台，不是传统蓝白 OA，也不是紫色渐变 AI SaaS。

关键词：

- 工业、精准、克制、专业
- 深色工作台 + 酸柠绿信号色
- 高信息密度，但不堆卡片
- 数字、任务状态、素材完整度优先
- 炫酷集中在 Dashboard、登录页和视频切片台

禁止：

- 玻璃拟态、霓虹外发光、粒子背景
- 所有内容都装进大圆角卡片
- 多种主色同时抢注意力
- 装饰性 3D 图标与 emoji
- 为了“大屏感”堆无决策价值的饼图

## 2. Token 原则

工程建立独立的 `src/styles/tokens.css`，组件内禁止出现裸色值、裸圆角和临时阴影。

核心语义：

```css
--bg
--sidebar
--surface
--surface-2
--surface-3
--text-1
--text-2
--text-3
--line
--line-strong
--accent
--accent-text
--accent-ink
--accent-soft
--done
--done-bg
--warn
--danger
--danger-bg
```

规范实现时以 `preview/tokens.css` 为起点。视觉组件只引用变量，换主题只改 Token。

## 3. 布局基线

- 左侧导航：220–228px，固定。
- 顶部工具栏：60–64px，固定。
- 页面内容区：最小 24px 内边距。
- 数据表、编辑器和时间轴允许横向扩展；不把桌面后台限制在窄容器中。
- 页面标题区固定顺序：英文 eyebrow → 中文标题 → 状态说明 → 唯一主操作。
- 每页最多一个酸柠绿主按钮，其余操作使用边框按钮或文字按钮。

## 4. 组件清单

第一阶段只建立以下组件，不先封装万能组件：

- `AdminShell`
- `SidebarNav`
- `TopSearch`
- `PageHeader`
- `PrimaryButton`
- `SecondaryButton`
- `StatusBadge`
- `MetricCard`
- `DataTable`
- `FilterBar`
- `AssetThumbnail`
- `MediaSlots`
- `RiskIndicator`
- `CoverageMatrix`
- `TaskQueue`
- `UploadDropzone`
- `MediaMatcher`
- `VideoTimeline`
- `TranscriptPanel`
- `TraceList`
- `EmptyState`
- `ConfirmDialog`

同类状态统一：

- 正常/已发布：`done`
- 处理中：`accent`
- 待审核/注意：`warn`
- 失败/未匹配：`danger`
- 禁用/归档：三级文字 + 低对比边框

## 5. 页面结构

### 登录

- 左侧品牌叙事，右侧登录表单。
- 背景允许极慢配重片旋转；必须支持 `prefers-reduced-motion`。
- 生产建议账号密码 + TOTP，不提供注册入口。

### Dashboard

- 顶部 5 个可点击关键指标。
- 主区使用“部位 × 素材槽位”覆盖矩阵。
- 右侧放任务流、AI Ops 收件箱、内容健康度圆环和 30 天趋势。
- 圆环只表达一个总体完成率，细项必须同时以文字列出。

### 动作 SKU

- 默认是高密度表格，不使用卡片网格。
- 搜索支持中文名、英文名、别名、ID。
- 筛选顺序：部位 → 器械 → 素材状态 → 主力动作。
- 每行必须看到缩略图、分类、风险、5 槽位、发布状态。

### 动作精修台

- 左侧素材预览与 5 槽位，右侧结构化字段与教案。
- 任何素材替换都产生 draft，不直接覆盖 published。
- “AI 一键补全”不能自动发布，结果进入人工审核态。

### 媒体池

- 左边批量上传和任务队列，右边待关联素材与候选动作。
- 单文件失败不能阻塞整个批次。
- 绑定动作前必须展示候选相似度和 SKU ID。

### 视频切片台

- 左侧视频与时间轴，右侧时间戳字幕。
- 高光片段、字幕选择和播放头必须联动。
- 最终确认时同时选择动作 SKU、素材槽位、需要入库的 Cues/Mistakes。

### AI Ops

- 主列表展示 intent、问题、user_id、延迟、处理状态。
- 支持一键送入评测 inbox。
- 聚合区只展示能驱动修复的指标：未命中、点踩、工具失败、延迟和高频缺口。

## 6. 动效

只动画 `transform` 和 `opacity`。

- 页面切换：`translateY(8px) + opacity`，300ms。
- 按压：`scale(.97)`，120ms。
- 圆环入场：整体 `scale + rotate + opacity`，不循环。
- 任务处理中：允许小型状态点呼吸，但不能让整张卡发光。
- 视频时间轴播放头可位移；不动画布局宽度。
- 所有动效必须提供 reduced-motion 降级。

## 7. 界面文案

- **跟在具体功能后的按钮用短词**：上下文已说明用途，如候选列表下的「新建」、抽屉里的「重选 / 同步库名 / 移除」。
- **全局入口写清楚对象**：与当前区块无关的顶栏/整页主按钮，如「新建任务」「发布」。
- **禁止讲解腔 / 口语串**：不要「没有合适的 → 新建」「库里没有，新建「xxx」」「打开要领抽屉」「把库名改成上面叫法」这类说明句当按钮文案。
- 确认框可以稍长（需写清后果）；旁注一句够用，不要堆教学文案。

## 8. AI 实施纪律与视觉还原要求

在实现每个后台页面时遵守以下纪律：

1. **直接复用 `preview/` 的 CSS Token 与 DOM 结构**：
   - 全局变量直接拷贝 `preview/tokens.css` 到 `src/styles/tokens.css`
   - 登录页对照 `preview/login.html`（截图 `preview/login-preview.png`）
   - Dashboard 对照 `preview/index.html`（截图 `preview/dashboard-preview.png`）
   - 动作 SKU 列表对照 `preview/workbench.html` 的 `#exercises`（截图 `preview/workbench-preview.png`）
   - 动作精修台对照 `preview/workbench.html` 的 `#detail`（截图 `preview/exercise-detail-preview.png`）
   - 媒体池对照 `preview/workbench.html` 的 `#pool`（截图 `preview/media-pool-preview.png`）
   - 高光切片台对照 `preview/workbench.html` 的 `#studio`（截图 `preview/video-studio-preview.png`）
   - AI Ops 对照 `preview/workbench.html` 的 `#ops`（截图 `preview/ai-ops-preview.png`）
2. **严禁样式退化**：
   - 所有颜色、圆角、字号、间距和阴影只引用 Token，禁止写裸色值。
   - 每页最多一个 accent 填充主按钮。
   - 数字必须使用 `tabular-nums`（`.num`）。
   - `input`、`textarea`、`select` 字号不低于 `16px`。
   - `hover` 只对 `@media (hover: hover) and (pointer: fine)` 生效。
   - 只动画 `transform` 和 `opacity`，并提供 `prefers-reduced-motion`。
   - 使用真实业务数据，必须包含 `loading`、`empty`、`error`、`disabled` 状态。

## 9. 页面验收清单

- 页面职责一眼可识别，主操作唯一。
- 在 1280、1440、1920 宽度下信息不挤压。
- 表格长名称、空值、异常状态不会破坏布局。
- 状态不只依赖颜色，同时有文字或图标。
- 所有数字列对齐。
- 无裸色值和临时样式。
- 动效关闭后不影响信息理解和操作。
- 键盘可聚焦，焦点状态清晰。

