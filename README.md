# 防踢优化包

QQ 机器人跑在服务器上，隔两小时就被踢一次——这个小包做了两件能做的事。

**先说清楚**：它**不能保证不被踢**。踢线的根子在「非官方客户端」，这个包只是把「能被识别出来的机械痕迹」抹掉。效果因人而异。

---

## 它做两件事

### ① 打开 NapCat 的反检测开关

```json
"bypass": { "hook": true, "window": true, "module": true,
            "process": true, "container": true, "js": true },
"o3HookMode": 1
```

会让 NapCat 不再如实上报自己的运行环境。**要重启 NapCat 才生效。**

### ② 把发送节奏从「均匀随机」改成「正态分布」

原本分条发送是 `随机 1~3 秒`，每个值等概率——这是机器特征。改成正态分布后：

```
均匀：  ╱‾‾‾‾‾‾‾‾╲        每个值一样多
正态：      ╱╲           大部分落在 1.7~2.4 秒，偶尔短偶尔长
          ╱    ╲
```

人打字就是这样。顺带给「收到消息后的等待时间」加了 ±25% 抖动——原来每次都精确等 3 秒，同样是可识别的节奏。

---

## 怎么用

把整个目录放到**内核目录**里（有 `src/` 那个目录），然后：

```bash
node run.mjs
```

想先看看会改什么：

```bash
node run.mjs --dry
```

改完重启内核（`systemctl restart qq-agent-bg`，或者关掉重开桌面版）。

### 改错了想退回去

```bash
node revert.mjs
```

---

## 安全设计

- 改任何文件前先备份到 `<内核>/.patch-backup/`
- 改完自动跑 `node --check`，语法不过就当场回滚
- 可以反复跑，已经改过的会跳过
- 找不到要改的那行（内核版本不同）会跳过并提示，不会乱改

---

## 注意事项

**内核升级会覆盖这两个文件**（`src/sender.js`、`src/orchestrator.js`）。升级后重新跑一次 `node run.mjs` 就行。

**别名**：这个只改「行为节奏」和「环境上报」。真正决定会不会被踢的是：

| 因素 | 能不能改 |
|:--|:--|
| 账号年龄（新号风控严） | ✗ 改不了 |
| 客户端特征（不是官方 QQ） | ✗ 改不了，只能靠反检测 |
| 登录设备/IP 异常 | 部分能（别频繁换 IP） |
| 发送节奏机械 | ✓ **这个包干的就是它** |

所以：**新号 + Linux 客户端 + 云服务器 IP**，这个组合本身就容易被盯上。这个包能降低概率，但不解决根本。

根治只有一条：**换真机**（家里一台小主机跑官方 QQ + NapCat），云端只做脑子。

---

## 附：手动版（不想跑脚本）

**反检测**：打开 NapCat 的 `napcat_<QQ号>.json`，加上那两段（见上面 ①）。

**正态分布**：编辑 `src/sender.js`，找到

```js
return Math.min(15000, Math.max(min, randInt(min, max) * 0.5 + byLength * 0.5));
```

换成

```js
const _mean = (min + max) / 2;
const _sd = Math.max(1, (max - min) / 6);
const _u1 = Math.random() || 1e-9;
const _u2 = Math.random();
const _g = _mean + _sd * Math.sqrt(-2 * Math.log(_u1)) * Math.cos(2 * Math.PI * _u2);
const _clamped = Math.min(max * 1.4, Math.max(min * 0.5, _g));
return Math.min(15000, Math.max(200, _clamped * 0.55 + byLength * 0.45));
```

再编辑 `src/orchestrator.js`，找到

```js
const ms = delay ?? Math.max(0, Number(getConfig().wakeDelayMs) || 2000);
```

换成

```js
const _base = delay ?? Math.max(0, Number(getConfig().wakeDelayMs) || 2000);
const ms = delay != null ? _base : Math.max(400, Math.round(_base * (0.75 + Math.random() * 0.5)));
```

---

MIT · 随便用，出问题自己担（改的是内核文件，记得先备份）
