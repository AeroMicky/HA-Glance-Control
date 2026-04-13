import fs from 'fs'
import { execSync } from 'child_process'

// Read version from app.json
const appJson = JSON.parse(fs.readFileSync('app.json', 'utf-8'))
const version = appJson.version

console.log(`[build] Packaging version ${version}...`)

try {
  // Pack with versioned filename
  const output = `ha-${version}.ehpk`
  execSync(`npx evenhub pack app.json dist -o ${output}`, { stdio: 'inherit' })
  console.log(`[build] ✓ Packaged to ${output}`)
} catch (err) {
  console.error('[build] Pack failed:', err.message)
  process.exit(1)
}
