import { createClient } from '@/lib/storage/supabase'

export async function getPageStates(projectId: string): Promise<Record<string, string>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('page_states')
    .eq('id', projectId)
    .single()

  if (error) throw new Error(`Failed to load page states: ${error.message}`)
  return (data?.page_states as Record<string, string>) ?? {}
}

export async function savePageStates(
  projectId: string,
  pageStates: Record<number, string>
): Promise<void> {
  const supabase = createClient()

  // Convert numeric keys to string keys for JSON storage
  const stringKeyedStates: Record<string, string> = {}
  for (const [key, value] of Object.entries(pageStates)) {
    stringKeyedStates[String(key)] = value
  }

  const { error } = await supabase
    .from('projects')
    .update({
      page_states: stringKeyedStates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)

  if (error) throw new Error(`Failed to save page states: ${error.message}`)
}

export async function savePageState(
  projectId: string,
  pageNumber: number,
  html: string
): Promise<void> {
  const supabase = createClient()

  // Use Supabase's JSONB update to merge just the changed page
  const { data: existing } = await supabase
    .from('projects')
    .select('page_states')
    .eq('id', projectId)
    .single()

  const pageStates = (existing?.page_states as Record<string, string>) ?? {}
  pageStates[String(pageNumber)] = html

  const { error } = await supabase
    .from('projects')
    .update({
      page_states: pageStates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)

  if (error) throw new Error(`Failed to save page state: ${error.message}`)
}
