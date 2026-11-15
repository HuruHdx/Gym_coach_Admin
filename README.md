# GymCoach Admin

桌面端动作资产工作台（Forge 锻造间风格）。

> **方案文档就在本仓库**：先看 [`docs/05-分阶段实施路线图.md`](./docs/05-分阶段实施路线图.md)。  
> 视觉稿在 [`preview/`](./preview/)。

## 工程位置（全部在桌面）

| 项目 | 路径 |
|---|---|
| **本后台前端** | `C:\Users\Huru Huru\Desktop\gym-admin` |
| **共用后端 + H5** | `C:\Users\Huru Huru\Desktop\gym-coach`（`api/` / `web/`） |

> **不要打开** `D:\桌面Dowload\gym-coach`（旧预览备份，无代码）  
> **不要打开** `D:\桌面Dowload\gym-admin-plan`（旧方案夹，文档已迁入本仓库 `docs/`）

## 文档

| 文件 | 说明 |
|---|---|
| [`docs/05-分阶段实施路线图.md`](./docs/05-分阶段实施路线图.md) | **主进度**：A0～A5 → H1～H2 |
| [`docs/07-计划模板后台配置台.md`](./docs/07-计划模板后台配置台.md) | 计划模板后台编排：板块 / 动作行 / 封面 / 角色 |
| [`docs/01-总体架构与功能方案.md`](./docs/01-总体架构与功能方案.md) | 模块与数据契约 |
| [`docs/04-后台UI规范与AI实施手册.md`](./docs/04-后台UI规范与AI实施手册.md) | Forge UI 规范 |
| [`preview/`](./preview/) | 登录 / Dashboard / 工作台静态稿与截图 |

## 开发

```powershell
# 终端 1：后端
cd "C:\Users\Huru Huru\Desktop\gym-coach\api"
uv run uvicorn app.main:app --reload --port 8000

# 终端 2：本后台
cd "C:\Users\Huru Huru\Desktop\gym-admin"
npm install
npm run dev
```

- 前端：`http://localhost:5174`
- API：`VITE_API_BASE`（默认 `http://127.0.0.1:8000`）
- 登录：账号 `admin`，密码默认与后端 `APP_TOKEN` 相同（本地 `dev-token`）

## 当前进度

- ✅ **A0**：数据入库 + 登录壳 + AdminShell
- ✅ **A1**：Dashboard + 动作列表/详情只读 + 待复核标记
- ✅ **A2**：单动作精修（改字段/别名/教案）+ 槽位上传发布回滚 + AI 教案草稿
- ✅ **A2.5**：新建动作 SKU（创建后进精修台补教案/素材）
- ✅ **A3**：批量上传与待关联池（自动匹配 + `/media-pool` 手动绑定）
- ✅ **H1/H2**：H5 动作库 + 训练卡缩略图/加今日/气泡挂卡
