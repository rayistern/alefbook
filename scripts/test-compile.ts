/**
 * Direct compile test - downloads project files and compiles locally.
 * Usage: railway run -- npx tsx scripts/test-compile.ts [projectId]
 */

import { createClient } from '@supabase/supabase-js'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const PROJECT_ID = process.argv[2] || '52158422-d348-4320-8709-8b82b9336484'

async function downloadFolder(
  supabase: ReturnType<typeof createClient>,
  storagePath: string,
  localDir: string,
  rootStoragePath: string
): Promise<void> {
  const { data: files, error } = await supabase.storage
    .from('projects')
    .list(storagePath)

  if (error || !files) {
    console.warn(`  Failed to list ${storagePath}:`, error)
    return
  }

  for (const file of files) {
    const fullStoragePath = `${storagePath}/${file.name}`
    const relativePath = fullStoragePath.replace(rootStoragePath + '/', '')
    const localPath = path.join(localDir, relativePath)

    if (file.id === null) {
      await fs.mkdir(localPath, { recursive: true })
      await downloadFolder(supabase, fullStoragePath, localDir, rootStoragePath)
    } else {
      if (relativePath.startsWith('output/')) continue
      await fs.mkdir(path.dirname(localPath), { recursive: true })
      const { data, error: dlError } = await supabase.storage
        .from('projects')
        .download(fullStoragePath)

      if (dlError || !data) {
        console.warn(`  FAILED to download: ${fullStoragePath}:`, dlError)
        continue
      }

      const buffer = Buffer.from(await data.arrayBuffer())
      await fs.writeFile(localPath, buffer)
      console.log(`  Downloaded: ${relativePath} (${buffer.length} bytes)`)
    }
  }
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)
  const tmpDir = path.join(os.tmpdir(), `alefbook-test-${Date.now()}`)

  console.log(`\n=== Setting up temp dir: ${tmpDir} ===`)
  await fs.mkdir(tmpDir, { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'pages'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'images'), { recursive: true })

  console.log(`\n=== Downloading project files ===`)
  const storagePath = `projects/${PROJECT_ID}`
  await downloadFolder(supabase, storagePath, tmpDir, storagePath)

  // List what we got
  console.log(`\n=== Files in temp dir ===`)
  const allFiles = await listFilesRecursive(tmpDir)
  for (const f of allFiles) {
    const stat = await fs.stat(f)
    const rel = path.relative(tmpDir, f)
    console.log(`  ${rel} (${stat.size} bytes)`)
  }

  // Check main.tex for \includegraphics
  const mainTex = await fs.readFile(path.join(tmpDir, 'main.tex'), 'utf-8')
  const includeMatches = mainTex.match(/\\includegraphics[^}]*\{[^}]+\}/g) || []
  console.log(`\n=== \\includegraphics calls in main.tex ===`)
  for (const m of includeMatches) {
    console.log(`  ${m}`)
    // Check if the referenced file exists
    const fileMatch = m.match(/\{([^}]+)\}$/)
    if (fileMatch) {
      const imgPath = path.join(tmpDir, fileMatch[1])
      try {
        const stat = await fs.stat(imgPath)
        console.log(`    -> EXISTS (${stat.size} bytes)`)
      } catch {
        console.log(`    -> MISSING!`)
      }
    }
  }

  // Try compiling
  console.log(`\n=== Compiling with latexmk ===`)
  const appDir = process.cwd()
  const texInputs = [
    tmpDir + '//',
    path.join(appDir, 'newImages_whitebg') + '//',
    path.join(appDir, 'newImages') + '//',
    path.join(appDir, 'newImages_notext') + '//',
    '',
  ].join(':')

  console.log(`TEXINPUTS=${texInputs}`)

  try {
    const { stdout, stderr } = await new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
      execFile(
        'latexmk',
        ['-xelatex', '-interaction=nonstopmode', '-halt-on-error', '-output-directory=' + tmpDir, 'main.tex'],
        {
          cwd: tmpDir,
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env, TEXINPUTS: texInputs },
        },
        (error, stdout, stderr) => {
          if (error) {
            console.error(`\n=== COMPILATION FAILED ===`)
            // Extract errors from log
            const log = stdout + '\n' + stderr
            const errorLines = log.split('\n').filter(l => l.startsWith('!'))
            for (const e of errorLines) console.error(`  ${e}`)

            // Check for file not found errors
            const notFound = log.match(/File .* not found/g) || []
            for (const nf of notFound) console.error(`  ${nf}`)

            console.error(`\nLast 1000 chars of log:`)
            console.error(log.slice(-1000))
            reject(error)
          } else {
            resolve({ stdout, stderr })
          }
        }
      )
    })

    console.log(`\n=== COMPILATION SUCCEEDED ===`)
    const pdfPath = path.join(tmpDir, 'main.pdf')
    const pdfStat = await fs.stat(pdfPath)
    console.log(`PDF size: ${pdfStat.size} bytes`)

  } catch {
    console.log('Compilation failed (see errors above)')
  }

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  console.log(`\n=== DONE ===`)
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(full))
    } else {
      files.push(full)
    }
  }
  return files
}

main().catch(err => {
  console.error('Test failed:', err)
  process.exit(1)
})
