#!/usr/bin/env node
/**
 * 防踢优化包 · 一键应用
 *
 * 做两件事：
 *   ① 打开 NapCat 的反检测开关（bypass 全套 + o3HookMode）
 *   ② 把内核的发送节奏从「均匀随机」改成「正态分布」，给防抖加抖动
 *
 * 用法：
 *   node run.mjs               # 自动找内核（当前目录 / 上一级）
 *   node run.mjs /path/kernel  # 指定内核目录
 *   node run.mjs --dry         # 只看会改什么，不落盘
 *
 * 安全：改之前都会备份到 <内核>/.patch-backup/，改完做语法检查，不过就自动回滚。
 * 可以反复跑 —— 已经改过的会跳过。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const DRY = args.includes('--dry')
const argPath = args.find((a) => !a.startsWith('--'))

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

/* ────────────────────────── 定位内核 ────────────────────────── */

function looksLikeKernel(dir) {
  return fs.existsSync(path.join(dir, 'src', 'sender.js'))
    && fs.existsSync(path.join(dir, 'src', 'orchestrator.js'))
}

function findKernel() {
  const tries = []
  if (argPath) tries.push(path.resolve(argPath))
  tries.push(process.cwd(), path.resolve(process.cwd(), '..'))
  for (const t of tries) if (looksLikeKernel(t)) return t
  return null
}

/* ──────────────────────── ① NapCat 反检测 ──────────────────────── */

function findNapcatConfigDirs() {
  const home = os.homedir()
  const candidates = [
    // Linux（本包作者的部署方式）
    path.join(home, 'Napcat/opt/QQ/resources/app/app_launcher/napcat/config'),
    '/root/Napcat/opt/QQ/resources/app/app_launcher/napcat/config',
    '/opt/QQ/resources/app/app_launcher/napcat/config',
    // Windows 常见位置
    path.join(home, 'AppData/Roaming/QQ/napcat/config'),
    path.join(home, 'AppData/Local/QQ/napcat/config'),
    // 和内核同级的 napcat 目录
    path.join(process.cwd(), 'napcat', 'config'),
  ]
  const found = []
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) found.push(c)
    } catch { /* ignore */ }
  }
  // 去重：同一个目录可能被 home 和绝对路径同时命中
  return [...new Set(found.map((p) => path.resolve(p)))]
}

function patchNapcat() {
  const dirs = findNapcatConfigDirs()
  if (!dirs.length) {
    console.log(C.warn('  ⚠ 没找到 NapCat 配置目录，跳过反检测这一步。'))
    console.log(C.dim('     如果是自己装的 NapCat，手动把下面这段加进 napcat_<QQ号>.json：'))
    console.log(C.dim('       "bypass": { "hook": true, "window": true, "module": true, "process": true, "container": true, "js": true },'))
    console.log(C.dim('       "o3HookMode": 1'))
    return { ok: false, reason: 'no-napcat' }
  }

  const targets = []
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) {
      // 只认 napcat_<纯数字>.json —— 那是账号配置；
      // napcat_protocol_*.json 是网络协议配置，加 bypass 会写坏
      if (/^napcat_\d+\.json$/.test(f)) targets.push(path.join(d, f))
    }
  }
  if (!targets.length) {
    console.log(C.warn('  ⚠ 找到了 NapCat 目录，但没有 napcat_<QQ号>.json（可能还没登录过）'))
    return { ok: false, reason: 'no-config' }
  }

  const bypass = { hook: true, window: true, module: true, process: true, container: true, js: true }
  let changed = 0

  for (const file of targets) {
    let raw
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (e) {
      console.log(C.err(`  ✗ 读不了 ${file}: ${e.message}`))
      continue
    }
    let conf
    try {
      conf = JSON.parse(raw)
    } catch (e) {
      console.log(C.err(`  ✗ ${path.basename(file)} 不是合法 JSON，跳过`))
      continue
    }

    const same = conf.o3HookMode === 1
      && conf.bypass && Object.keys(bypass).every((k) => conf.bypass[k] === true)
    if (same) {
      console.log(C.dim(`  · ${path.basename(file)} 反检测已经是全开的`))
      continue
    }

    conf.bypass = { ...(conf.bypass || {}), ...bypass }
    conf.o3HookMode = 1

    if (!DRY) {
      const bak = file + '.bak-' + Date.now()
      fs.copyFileSync(file, bak)
      fs.writeFileSync(file, JSON.stringify(conf, null, 2), 'utf8')
    }
    changed++
    console.log(C.ok(`  ✓ ${path.basename(file)} 反检测已打开`) + C.dim('（重启 NapCat 生效）'))
  }

  if (!changed) console.log(C.dim('  · 反检测本来就好了，没动'))
  return { ok: true }
}

/* ──────────────────── ② 内核发送节奏改正态 ──────────────────── */

const SENDER_OLD = /return Math\.min\(15000, Math\.max\(min, randInt\(min, max\) \* 0\.5 \+ byLength \* 0\.5\)\);/
const SENDER_NEW = `// 正态分布（Box-Muller）：均值在区间中点，标准差 = 区间/6，99.7% 落在 min~max 内。
    // 均匀分布会让间隔在区间里等概率出现，行为风控容易识别；正态更像真人。
    const _mean = (min + max) / 2;
    const _sd = Math.max(1, (max - min) / 6);
    const _u1 = Math.random() || 1e-9;
    const _u2 = Math.random();
    const _g = _mean + _sd * Math.sqrt(-2 * Math.log(_u1)) * Math.cos(2 * Math.PI * _u2);
    const _clamped = Math.min(max * 1.4, Math.max(min * 0.5, _g));
    return Math.min(15000, Math.max(200, _clamped * 0.55 + byLength * 0.45));`

const WAKE_OLD = /const ms = delay \?\? Math\.max\(0, Number\(getConfig\(\)\.wakeDelayMs\) \|\| \d+\);/
const WAKE_NEW = `const _base = delay ?? Math.max(0, Number(getConfig().wakeDelayMs) || 2000);
    // 每次都在同一个秒数上开跑，也是可识别的节奏。±25% 抖动。
    const ms = delay != null ? _base : Math.max(400, Math.round(_base * (0.75 + Math.random() * 0.5)));`

function patchKernel(root) {
  const jobs = [
    { name: '发送间隔（sender.js）', file: path.join(root, 'src', 'sender.js'), old: SENDER_OLD, neu: SENDER_NEW, marker: '_g = _mean' },
    { name: '唤醒防抖（orchestrator.js）', file: path.join(root, 'src', 'orchestrator.js'), old: WAKE_OLD, neu: WAKE_NEW, marker: '0.75 + Math.random() * 0.5' },
  ]
  const bakDir = path.join(root, '.patch-backup')
  const touched = []

  for (const j of jobs) {
    let txt
    try {
      txt = fs.readFileSync(j.file, 'utf8')
    } catch (e) {
      console.log(C.err(`  ✗ 读不了 ${path.basename(j.file)}: ${e.message}`))
      continue
    }
    if (txt.includes(j.marker)) {
      console.log(C.dim(`  · ${j.name} 已经改过了`))
      continue
    }
    if (!j.old.test(txt)) {
      console.log(C.warn(`  ⚠ ${j.name} 找不到要改的那行（内核版本不同？）已跳过`))
      continue
    }
    if (!DRY) {
      fs.mkdirSync(bakDir, { recursive: true })
      const bak = path.join(bakDir, path.basename(j.file) + '.' + Date.now())
      fs.copyFileSync(j.file, bak)
      fs.writeFileSync(j.file, txt.replace(j.old, j.neu), 'utf8')
    }
    touched.push(j)
    console.log(C.ok(`  ✓ ${j.name} 已改正态分布`))
  }

  // 语法检查
  if (!DRY && touched.length) {
    for (const j of touched) {
      try {
        execFileSync(process.execPath, ['--check', j.file], { stdio: 'pipe' })
      } catch (e) {
        console.log(C.err(`  ✗ ${path.basename(j.file)} 改完语法不过，正在回滚`))
        const baks = fs.readdirSync(bakDir).filter((f) => f.startsWith(path.basename(j.file)))
        if (baks.length) {
          const latest = baks.sort().pop()
          fs.copyFileSync(path.join(bakDir, latest), j.file)
          console.log(C.ok('  ✓ 已回滚'))
        }
        return { ok: false }
      }
    }
    console.log(C.ok('  ✓ 语法检查通过'))
  }
  return { ok: true, touched: touched.length }
}

/* ────────────────────────── 主流程 ────────────────────────── */

console.log('')
console.log(C.bold('防踢优化包'))
console.log(C.dim(DRY ? '（--dry 模式：只看会改什么，不落盘）' : ''))
console.log('')

console.log(C.bold('[1/2] NapCat 反检测'))
patchNapcat()

console.log('')
console.log(C.bold('[2/2] 内核发送节奏'))
const root = findKernel()
let kernelOk = false
if (!root) {
  console.log(C.warn('  ⚠ 没找到内核目录（找不到 src/sender.js）'))
  console.log(C.dim('     在内核目录里跑：node run.mjs'))
  console.log(C.dim('     或者指定路径：node run.mjs /path/to/qq-agent'))
} else {
  console.log(C.dim(`     内核：${root}`))
  const r = patchKernel(root)
  kernelOk = r.ok
}

console.log('')
console.log(C.dim('────────────────────────────────────────'))
if (DRY) {
  console.log(C.warn('这是预览，什么都没改。去掉 --dry 再跑一次才会真的生效。'))
} else {
  console.log(C.bold('下一步：'))
  console.log('  1. 重启内核（systemctl restart qq-agent-bg / 关掉重开桌面版）')
  console.log('  2. 反检测那部分要重启 NapCat 才生效')
  console.log('')
  console.log(C.warn('注意：内核升级会覆盖这两个文件，升级后要重新跑一次。'))
  console.log(C.dim(`备份在：${root ? path.join(root, '.patch-backup') : '<内核>/.patch-backup'}`))
}
console.log('')
