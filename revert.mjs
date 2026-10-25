#!/usr/bin/env node
/**
 * 防踢优化包 · 回滚
 *
 * 把 run.mjs 改过的内核文件恢复到最近一次备份。
 *
 * 用法：
 *   node revert.mjs               # 自动找内核
 *   node revert.mjs /path/kernel  # 指定内核目录
 *   node revert.mjs --list        # 只列出有哪些备份，不动
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const LIST = args.includes('--list')
const argPath = args.find((a) => !a.startsWith('--'))

const C = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
}

function looksLikeKernel(dir) {
  return fs.existsSync(path.join(dir, 'src', 'sender.js'))
}

function findKernel() {
  const tries = []
  if (argPath) tries.push(path.resolve(argPath))
  tries.push(process.cwd(), path.resolve(process.cwd(), '..'))
  for (const t of tries) if (looksLikeKernel(t)) return t
  return null
}

const root = findKernel()
if (!root) {
  console.log(C.err('没找到内核目录。在内核目录里跑，或者：node revert.mjs /path/to/qq-agent'))
  process.exit(1)
}

const bakDir = path.join(root, '.patch-backup')
if (!fs.existsSync(bakDir)) {
  console.log(C.warn('没有找到备份目录 .patch-backup —— 说明没跑过 run.mjs，或者备份被删了。'))
  process.exit(0)
}

const baks = fs.readdirSync(bakDir).sort()
if (!baks.length) {
  console.log(C.warn('备份目录是空的。'))
  process.exit(0)
}

// 每个源文件取最新一份备份
const latest = new Map()
for (const b of baks) {
  const src = b.replace(/\.\d+$/, '')
  latest.set(src, b)
}

console.log('')
console.log(C.bold('可用的备份：'))
for (const [src, b] of latest) {
  const st = fs.statSync(path.join(bakDir, b))
  console.log(`  ${src}  ${C.dim('← ' + b + '  ' + st.mtime.toLocaleString())}`)
}
console.log('')

if (LIST) {
  console.log(C.dim('（--list 模式，什么都没改）'))
  console.log('')
  process.exit(0)
}

let n = 0
for (const [src, b] of latest) {
  const target = path.join(root, 'src', src)
  try {
    fs.copyFileSync(path.join(bakDir, b), target)
    console.log(C.ok(`  ✓ 已恢复 src/${src}`))
    n++
  } catch (e) {
    console.log(C.err(`  ✗ 恢复 src/${src} 失败：${e.message}`))
  }
}

console.log('')
if (n) {
  console.log(C.bold(`恢复了 ${n} 个文件。重启内核生效。`))
  console.log('')
  console.log(C.dim('NapCat 的反检测开关没有回滚（那个开着没坏处，想关就手动改 napcat_<QQ>.json）。'))
} else {
  console.log(C.warn('一个都没恢复。'))
}
console.log('')
