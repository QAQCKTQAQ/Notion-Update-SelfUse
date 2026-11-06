# 写作热力图 · GitHub Actions 版

GitHub 风格贡献热力图，直接嵌进 Notion 主页。数据由 GitHub Actions 每小时从 Notion 拉取并写回仓库，**不需要本机运行任何程序，不需要 WorkBuddy，不需要 Notion 会员**。

链路：`GitHub Actions（每小时）` → `Notion API 只读时间戳` → `activity.json` → `GitHub Pages` → `Notion /embed 里的 iframe`

## 隐私

- 同步脚本 `scripts/sync.mjs` 只使用页面的 `created_time`、`last_edited_time`、`parent`、`archived`，以及 `id`（仅用于按页面去重）。
- **不读取、不打印、不输出**标题、`properties`、正文、块内容、附件、URL。
- `activity.json` 只有 `{"updatedAt": "...", "days": [{"date": "YYYY-MM-DD", "count": N}]}`。公开仓库里也只有「哪天有几次活动」，没有任何可识别内容。
- 时间按 **GMT+8** 归类；每个页面取其创建/最后编辑中较晚的一个时间戳计一次。

## 一、Notion 侧（约 2 分钟）

1. 打开 <https://app.notion.com/developers/connections>（中文界面是「**开发者工具 → 连接**」标签）→ 点 **新建连接 / Create a new connection**，名字建议填 `heatmap-reader`（以后好认），工作区选你自己的。
   - 弹窗里「**验证方式**」保持默认选中的 **API 令牌**，**不要选 OAuth**：同步脚本用的是静态 `Bearer` token；OAuth 面向要上架市集、支持多工作区的公开应用，需要交互式授权流程，这里用不上。然后点「创建连接」。
   - 顶部还有「Workers」「个人访问令牌」「MCP 令牌」等标签，**都不用点**：Workers 要 Business/Enterprise，个人访问令牌有效期只有 1 年，MCP 令牌与本方案无关。
   - 需要你是工作区 Owner；个人工作区默认就是。
2. 创建后进入该连接的 **配置** 标签，按最小权限调整「功能」（新建时默认会多勾）：
   - **内容功能**：只保留 ✅ **读取内容**；**取消** ✅ 更新内容、✅ 插入内容。脚本只调 `POST /v1/search` 读时间戳，不需要任何写权限。
   - **用户功能**（单选）：改选 **没有用户信息**。默认可能停在「读取用户信息，包括电子邮件地址」，这个方案完全不碰用户接口，不该要邮箱。
   - **评论功能 / 代理功能**：全部保持不勾。
   - 新版界面**没有**单独的「内容查询 / Content queries」开关，search 已包含在「读取内容」里，不用找。
   - 复制上方 **集成令牌**（`ntn_` 开头，右侧有复制图标）。**不要发给任何人，也不要贴进对话或提交到仓库。**
3. 授权页面 —— **要给全部笔记页面，不是只给某一页**：脚本用空 query 的 search 枚举「集成可见的全部页面」，授权范围就是热力图的统计范围，只给一页会让绿格子明显偏少。
   - **开发者工具里**（推荐）：打开刚建的连接 → **内容访问权限** 标签 → **Edit access**。若界面里有「全部 / 整个工作区 / Select all」之类的选项，直接选它最省事；否则把**所有顶层页面**都勾上（这个工作区有 7 个顶层页面，不只是「汇总」）。
   - **Notion 页面里**：对每个顶层页面 → 右上角 `···` → **Connections** → **+ Add connection** → 选刚建的集成。
   - 页面权限**向下继承**：授权父页面后，其所有子页面与数据库行自动可读，不用给 100 多页逐个点。
   - 两个自建统计库（写作活跃度、写作热力看板）**不用特意避开**，脚本已按 ID 排除，不会让数字自我膨胀。
   - 新建连接默认**零页面权限**，跳过这步会在 Actions 里直接报 403。跑完看日志里「去重后 M 个页面」是否约 100+，这是判断有没有漏授权最靠谱的办法。

> 统计口径提醒：主页、模板页这类「工具页」的编辑也会算作一次活动（与之前 WorkBuddy 版一致）。如果只想统计真实日记/笔记，把要排除的页面 ID 用 `EXCLUDE_IDS` 环境变量追加（逗号分隔），或改脚本里的默认排除表。

> 为什么不用 Personal Access Token：PAT 有效期只有 1 年，免费计划还只有 Owner 能创建；internal connection token 长期有效，配一次就不用管。

## 二、GitHub 侧（约 3 分钟）

1. 新建**公开**仓库（例如 `writing-heatmap`），把本目录所有文件上传到 `main` 分支根目录，保持这个结构：

   ```
   .
   ├── index.html                    # 热力图页面
   ├── activity.json                 # 数据（脚本会自动改写）
   ├── .nojekyll                     # 让 Pages 原样发布，别删
   ├── scripts/sync.mjs              # 同步脚本
   ├── .github/workflows/refresh.yml # 每小时定时任务
   └── README.md
   ```

2. 仓库 → **Settings → Secrets and variables → Actions → New repository secret**：
   - Name：`NOTION_TOKEN`
   - Secret：粘贴第一步的 `ntn_...` token

3. 仓库 → **Settings → Pages** → Build and deployment → Source 选 **Deploy from a branch**，Branch 选 `main` / `/ (root)` → Save。
   > 一定要选「Deploy from a branch」。如果选「GitHub Actions」作为 Pages 来源，定时任务用 GITHUB_TOKEN 推送的提交不会触发新的部署工作流，数据就不会上线。

4. 稍等 1–2 分钟，打开 `https://<你的用户名>.github.io/<仓库名>/` 确认能看到热力图。

## 三、跑一次并核对

仓库 → **Actions → 刷新写作热力数据 → Run workflow**（手动触发一次）。日志里应该有：

```
已扫描 N 条页面记录，去重后 M 个页面
活跃日期 X 天，贡献总数 Y
```

**重点看 `去重后 M 个页面`**：它应该接近你的笔记总数（约 100+）。如果只有个位数，说明第一步的根页面授权没生效，回去检查 Add connections。脚本在读到 0 个页面时会主动报错中止，不会把历史数据清空。

之后每小时 UTC 整点自动运行；只有 `activity.json` 内容变化时才提交，避免无意义的 commit 历史。

## 四、接进 Notion

拿到 Pages 链接后，在 Notion 主页里新建一个嵌入块：

```
/embed  →  粘贴 https://<用户名>.github.io/<仓库名>/
```

拖动嵌入块下边缘把高度调到约 260px 以上。之前那条 WorkBuddy 的旧嵌入块可以手动删掉；**确认新链路连续跑两天正常后**，再停用 WorkBuddy 里的「刷新 Notion 写作热力」定时任务，期间两条链路并存互不影响。

## 换托管平台 / 换数据源

页面支持 `?src=<完整 JSON URL>` 覆盖数据源，例如：

```
https://<用户名>.github.io/<仓库名>/?src=https://其他站点/activity.json
```

换平台时只改这一个参数，不用改代码。GitHub Pages 的 `activity.json` 带 `Access-Control-Allow-Origin: *`，所以跨域也能读。离线用 `/html` 直接上传 `index.html` 时，页面会用文件内置的快照数据（不会自动更新）。

## 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| Actions 报 `HTTP 401` | token 失效或粘贴时带了空格，重新复制并更新 Secret |
| Actions 报 `HTTP 403` | 集成没被授权页面，或没开「读取内容」；检查开发者工具的「内容访问权限」，或根页面 Connections |
| 日志里页面数很少 | 授权范围不足；在「内容访问权限 → Edit access」里把顶层根页面勾上（子页面会继承） |
| 热力图一直显示旧数据 | Pages 没重新构建；确认 Source 是 Deploy from a branch，或手动重跑 workflow |
| 方块全灰 | `activity.json` 没被页面读到；浏览器打开 `/activity.json` 看是否 200 |
| Notion 里嵌入空白 | 嵌入块太矮，拖高；或浏览器缓存，刷新页面 |

## 本地试跑

```bash
NOTION_TOKEN=ntn_xxx node scripts/sync.mjs
```

需要 Node.js 18+，无 npm 依赖、无需 `npm install`。
