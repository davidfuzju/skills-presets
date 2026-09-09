# skills-presets 设计文档

> 本文档记录 `mattpocock-skills` 这个接入目标的设计与实测依据。插件本身是通用预设层，
> 接入其他三方 skill 见 [README](./README.md) 与 [`targets.json`](./targets.json)。

给 `mattpocock-skills` 挂预设的外挂包。不改 matt 源码，全部落在 hook 层。

基于本机实测：Claude Code `2.1.263`，`mattpocock-skills@1.2.3`。

**v2 相对 v1**
1. 作用域门控：hook 效果限定在"本会话 + implement 运行期间"，不再外泄
2. 删掉 `git config merge.ff false`（会影响人工操作）
3. tracker 逻辑全部交还 matt 的 `docs/agents/issue-tracker.md`，本包零实现

**v3 相对 v2**
4. 修掉 `--no-ff` 改写的字符串替换 bug（会劈坏含 `merge` 的分支名），改用锚定正则
5. 新增 §7：rtk 兼容实测。结论是**不需要探测 rtk 是否安装**，同一套代码两种场景都成立

---

## 0. 两条设计原则

**原则 A — 作用域不外泄。** `PreToolUse` 的 `matcher` 只能匹配工具名，没有"只在某 skill
运行期间"的原生条件。所以凡是会影响通用工具（`Bash`、`ExitWorktree`）的分支，一律先查
会话门控状态，不在 implement 期间就 `exit 0`。

**原则 B — tracker 零实现。** 本包不判断也不操作 issue tracker。所有 ticket 操作交还给
`docs/agents/issue-tracker.md`（matt 的 `/setup-matt-pocock-skills` 产物）。本包只做两件事：
判断它是哪一种（读第一行），以及提醒 agent 去读它。

---

## 1. 三条需求 → 机制映射

| # | 需求 | 触发点 | 机制 | 强度 | 作用域 |
|---|---|---|---|---|---|
| 1 | implement 走 worktree | `UserPromptSubmit` / `PreToolUse:Skill` | 注入 preflight，模型调 `EnterWorktree` | 软 | 仅匹配 `/implement` |
| 1 | 命名带 ticket 号 | 同上 | 注入命名**规则**，slug 由模型取到标题后生成 | 软 | 同上 |
| 2 | 合并 `--no-ff` | `PreToolUse:Bash` | 门控 + `updatedInput` 自动补参 | **硬** | 本会话 + implement 期间 |
| 2 | 保留 worktree 目录 | `PreToolUse:ExitWorktree` | 门控 + `deny` 拦 `action:"remove"` | **硬** | 本会话 + implement 期间 |
| 3 | assign 给当前用户 | preflight 注入 | 指向 tracker 文件的 **Claim** 约定 | 软 | 仅本次 implement |
| 3 | 完成后 close | `Stop` 注入 | 指向 **Resolve** 约定，列清单等你点头 | 软 + 人工闸 | 同上 |

需求 2 是硬的（`updatedInput` / `deny` 不依赖模型配合），需求 1 和 3 是软的（必须由模型
执行工具调用和 tracker 操作，hook 无法代劳）。

---

## 2. 作用域门控（v2 核心）

```
/implement #11  ──> UserPromptSubmit hook
                     ├─ 写 /tmp/skills-presets-<session_id>.json   ← 门开
                     └─ 注入 preflight
                     
    ...implement 运行中...
       每次 Bash        ──> hook 触发，查门 → 开着且是 git merge → 补 --no-ff
       ExitWorktree     ──> hook 触发，查门 → 开着且 action=remove → deny
       
Stop            ──> 注入 closeout 清单（只发一次）
SessionEnd      ──> rm 门控文件                              ← 门关
```

门控文件带 `session_id`，所以：
- 同一仓库里**另一个**会话不受影响
- 没跑过 `/implement` 的会话完全无感
- 会话结束自动清理，不留残留状态

**诚实说明**：hook **进程**仍然会在每次 `Bash` 调用时被拉起（matcher 只能按工具名过滤），
只是绝大多数情况下第一行查完门就 `exit 0`。开销是一次 `bash`+`jq`。

`hooks.json` 支持 `if` 字段做命令级预过滤（`"if": "Bash(git merge:*)"`，官方
`security-guidance` 插件在用），能省掉这次进程拉起。但若装了 rtk，它的全局 hook 会把
`git merge` 改写成 `rtk git merge`，`if` 究竟在改写前还是改写后求值我没验证——**先用脚本
内门控，`if` 当成探针验证后的可选优化**。

---

## 3. 源码在哪

本文档只记录**为什么**，不复制源码——复制必然不同步。实现见仓库内：

| 文件 | 职责 |
| --- | --- |
| `hooks/hooks.json` | 挂载点声明 |
| `hooks/dispatch.sh` | 全部逻辑，约 100 行 |
| `policy/implement-preflight.md` | `/implement` 触发时注入的正文 |
| `policy/implement-closeout.md` | 收尾清单 |
| `policy/no-tracker.md` | 未配 tracker 时的处置 |

`policy/` 下三个文件是纯 Markdown，改规则不用动代码。

---

## 5. 装配与验证

```bash
claude plugin marketplace add <owner>/skills-presets
claude plugin install skills-presets@skills-presets
```

hook 改动**要重启会话才生效**。先跑探针确认 `/implement` 走哪条路径（当唯一 hook 装上，
跑一次 `/implement #11`）：

```bash
jq -c '{e:.hook_event_name,t:.tool_name,s:.tool_input.skill,p:(.prompt//""|.[0:80])}' >> /tmp/hook-probe.log
```

- 只见 `UserPromptSubmit` → `prompt` 分支是主力
- 见到 `PreToolUse` + `tool_name:"Skill"` → `skill` 分支也在起作用

两条都留着，成本只是重复注入一次。

验收清单：

| 验证项 | 做法 | 期望 |
|---|---|---|
| 不外泄 | 新开一个会话，不打 `/implement`，跑 `git merge foo` | 不被改写 |
| 会话隔离 | 会话 A 跑 implement，会话 B 同仓库跑 `git merge` | B 不受影响 |
| 门控生效 | 会话 A 里 `git merge foo` | 变成 `git merge --no-ff foo`，有 systemMessage |
| worktree 保护 | implement 期间 `ExitWorktree` remove | 被 deny |
| 清理 | 退出会话后 `ls /tmp/skills-presets-*` | 该会话的文件已删 |

---

## 6. 已知边界

### 6.1 需求 1 只能是软约束

`EnterWorktree` **只能由模型调用**，hook 没有代调工具的能力，所以做不到像 `--no-ff`
那样物理保证。但这条软约束有官方背书 —— `EnterWorktree` 工具说明写着：

> Use this tool ONLY when explicitly instructed to work in a worktree — either by the
> user directly, **or by project instructions (CLAUDE.md / memory)**。

注入的 preflight 正好落在它认可的授权来源里。**建议在目标仓库 `CLAUDE.md` 再写一行**做锚点：

```markdown
implement 一律在独立 worktree 中进行，命名 `ticket-<号>-<短描述>`。
```

### 6.2 删掉 git config 的代价

v1 里的 `git config --local merge.ff false` 已按要求移除。代价是明确的：**在终端里手动敲的
`git merge` 没有任何东西兜底**。hook 只作用于 agent 的 Bash 工具调用，人工命令不过 hook。
若愿意接受这个外泄，一行 `git config --local merge.ff false` 随时可加。

### 6.3 tracker 兼容性对照

| tracker | 判定依据（第一行） | ticket 引用形态 | worktree 名 |
|---|---|---|---|
| GitHub | `# Issue tracker: GitHub` | `#11` | `ticket-11-<标题 slug>` |
| GitLab | `# Issue tracker: GitLab` | `#11` | 同上 |
| Local Markdown | `# Issue tracker: Local Markdown` | `.scratch/<feature>/issues/03-login.md` | `ticket-03-login`（直接用文件名） |
| Other（自由口述） | 都不匹配 → `other` | 未知 | 让模型按该文件描述自行判断 |

**Local Markdown 没有全局编号**：ticket 是每个 feature 目录下从 `01` 起编号的，
所以 `/implement #11` 在这种仓库里不成立，preflight 已按 tracker 分流处理。

**GitHub 的号码空间和 PR 共享**：`#42` 可能是 PR。matt 的模板写了处置（先 `gh pr view`
再回退 `gh issue view`），照它做即可，本包不重复实现。

### 6.4 其他

| 项 | 说明 |
|---|---|
| `additionalContext` 上限 | 8000 字符（`systemMessage` 4000，`permissionDecisionReason` 2000） |
| hook 进程开销 | 每次 Bash 调用都会拉起一次脚本，查完门即退；`if` 预过滤可省，但需先验证与 rtk 改写的先后 |
| `rtk` 改写 | 见 §7。实测 `git merge` 被 rtk 放行，两个 hook 不冲突；`(rtk +)?` 仍不能省 |
| 合并要在主检出跑 | 分支被 worktree 占用，只能 `git -C <主检出> merge`，且主检出须干净 |
| 二次合并 | worktree 保留后继续开发再合，仍走 `--no-ff` |
| matt 升级 | 挂工具层，改 SKILL.md 措辞不影响；只有改 skill **名字** 才需动 `*implement*` 匹配 |
| 缓存目录 | `cache/.../1.2.3/` 带版本号且官方 marketplace 自动更新，直接改动升级即丢 |

---

## 7. rtk 兼容（实测 rtk 0.48.0）

**结论：不需要探测 rtk 是否安装，同一套代码两种场景都成立。**

### 7.1 rtk 的 PreToolUse hook 实际行为

把伪造的 hook payload 喂给 `rtk hook claude` 测出来的：

| 命令 | rtk 的处置 |
|---|---|
| `git merge foo` | **放行**（零输出） |
| `git merge --no-ff foo` | **放行** |
| `git rev-parse --abbrev-ref HEAD` | **放行** |
| `git status --porcelain` | 改写为 `rtk git status --porcelain` |
| `git worktree list` | 改写 |
| `git commit -m x` | 改写 |
| `rtk git status`（已带前缀） | 放行，不会重复包裹 |

### 7.2 为什么两个 hook 不会打架

真正的风险不是正则写没写 `rtk`，而是**两个 PreToolUse:Bash hook 同时返回 `updatedInput`
时谁赢**（顺序未定义）。这个风险在这里不存在：

> 本包唯一改写的命令类是 `git merge`，而这正是 rtk 放行的。
> 无论谁先跑，另一方看到的都是自己不管的命令。

而且两个方向都验证过是安全的：

- rtk 先跑（假设未来它开始接管 merge）→ 本包看到 `rtk git merge foo`，
  `(rtk +)?` 可选组照样匹配 → `rtk git merge --no-ff foo` ✅
- 本包先跑 → rtk 看到 `git merge --no-ff foo`，实测放行 ✅

### 7.3 没装 rtk 的场景

rtk 的 hook 根本不注册，本包的正则里 `(rtk +)?` 是可选组，匹配裸 `git merge`。
**零分支、零探测、零配置。**

### 7.4 `--porcelain` 判据为什么仍然可信

closeout 要判断主检出是否干净，而 `git status --porcelain` 会被 rtk 接管。实测同一仓库：

| 状态 | 原生 | 经 rtk |
|---|---|---|
| 干净 | （空） | （空） |
| 有未跟踪文件 | `?? f.txt` | `?? f.txt` |

逐字节一致，判据不受影响。但策略里仍写死"**以输出是否为空为准，不要解析具体行**"，
防止 rtk 未来改压缩格式。

### 7.5 改写逻辑的边界用例

v2 用的 `${cmd/merge/merge --no-ff}` 是 bash 字符串替换，会命中**第一个** `merge` 子串，
实测会劈坏分支名：

```
git checkout merge-branch && git merge foo
  → git checkout merge --no-ff-branch && git merge foo     ← 坏了
```

v3 改用锚定正则（`\b` 在 macOS BSD sed 不可用，故末尾补空格后匹配 `merge ` 字面量）：

| 输入 | 输出 |
|---|---|
| `git merge foo` | `git merge --no-ff foo` |
| `rtk git merge foo` | `rtk git merge --no-ff foo` |
| `git -C /repo merge claude/ticket-11-x` | `git -C /repo merge --no-ff claude/ticket-11-x` |
| `git merge origin/merge-fix` | `git merge --no-ff origin/merge-fix` |
| `git checkout merge-branch && git merge foo` | 只改第二个 ✅ |
| `git merge-base main HEAD` | 不动 ✅ |
| `git mergetool` | 不动 ✅ |
| `echo 'git merge'` | 不动 ✅ |

### 7.6 rtk 升级后要复测

rtk 若把 `git merge` 加进过滤列表，§7.2 的前提就变了（虽然两个方向都验证过安全）。
把这条加进验收清单，rtk 升级后重跑一次探针：

```bash
printf '{"session_id":"p","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git merge foo"}}' | rtk hook claude
```

输出为空 = 仍然放行 = §7.2 成立。
