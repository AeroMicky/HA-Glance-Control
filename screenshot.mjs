#!/usr/bin/env node
// Move the most recent simulator screenshot to screenshots/<name>.png
// Usage: node screenshot.mjs <page-name>
//    or: npm run screenshot -- <page-name>

import { readdirSync, statSync, renameSync, mkdirSync } from 'fs'
import { join } from 'path'

const name = process.argv[2]
if (!name) {
  console.error('Usage: node screenshot.mjs <page-name>')
  console.error('Example: node screenshot.mjs home')
  process.exit(1)
}

const slug = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-')

mkdirSync('screenshots', { recursive: true })

const candidates = readdirSync('screenshots')
  .filter(f => f.startsWith('glasses_') && f.endsWith('.png'))
  .map(f => ({ name: join('screenshots', f), mtime: statSync(join('screenshots', f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)

if (candidates.length === 0) {
  console.error('No glasses_*.png found in screenshots/.')
  console.error('Take a screenshot in the simulator first (camera icon).')
  process.exit(1)
}

const src = candidates[0].name
const dst = join('screenshots', `${slug}.png`)

renameSync(src, dst)
console.log(`Saved: ${dst}`)
