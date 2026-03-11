import fs from 'fs'
import path from 'path'
import { createClient } from '@/lib/storage/supabase'

export async function GET() {
  const diagnostics: Record<string, unknown> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    cwd: process.cwd(),
    nodeVersion: process.version,
  }

  // Check template files
  const pagesDir = path.join(process.cwd(), 'templates/haggadah/pages')
  const stubsDir = path.join(process.cwd(), 'templates/stubs')
  const metadataDir = path.join(process.cwd(), 'templates/metadata')

  diagnostics.templates = {
    pagesDir: {
      exists: fs.existsSync(pagesDir),
      files: fs.existsSync(pagesDir) ? fs.readdirSync(pagesDir).length : 0,
    },
    stubsDir: {
      exists: fs.existsSync(stubsDir),
      files: fs.existsSync(stubsDir) ? fs.readdirSync(stubsDir).length : 0,
    },
    metadataDir: {
      exists: fs.existsSync(metadataDir),
      files: fs.existsSync(metadataDir) ? fs.readdirSync(metadataDir).map(f => f) : [],
    },
    // Also check old wrong path
    oldPagesDir: {
      exists: fs.existsSync(path.join(process.cwd(), 'templates/pages')),
    },
  }

  // Check Chromium
  const chromiumPath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
  diagnostics.chromium = {
    path: chromiumPath,
    exists: fs.existsSync(chromiumPath),
  }

  // Check Supabase connectivity
  try {
    const supabase = createClient()
    const { error } = await supabase.from('users').select('id').limit(1)
    diagnostics.supabase = {
      connected: !error,
      error: error?.message,
    }

    // Check renders table
    const { error: rendersError } = await supabase.from('renders').select('id').limit(1)
    diagnostics.rendersTable = {
      accessible: !rendersError,
      error: rendersError?.message,
    }

    // Check renders storage bucket
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets()
    diagnostics.storageBuckets = {
      error: bucketsError?.message,
      buckets: buckets?.map(b => b.name) ?? [],
    }
  } catch (err) {
    diagnostics.supabase = { connected: false, error: String(err) }
  }

  // Check env vars (existence only, not values)
  diagnostics.envVars = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    PUPPETEER_EXECUTABLE_PATH: process.env.PUPPETEER_EXECUTABLE_PATH || '(not set, default /usr/bin/chromium)',
  }

  return Response.json(diagnostics, {
    headers: { 'Cache-Control': 'no-cache' },
  })
}
