import { createServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function HomePage() {
  let user = null
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabase()
    user = (await supabase.auth.getUser()).data.user
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <h1 className="text-4xl font-bold mb-2">AlefBook</h1>
        <p className="text-muted-foreground mb-8">Create LaTeX books with AI assistance</p>
        <div className="flex gap-4">
          <Link
            href="/auth/login"
            className="rounded-md bg-primary px-6 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            Get Started
          </Link>
          <Link
            href="/gallery"
            className="rounded-md border border-input px-6 py-2 text-sm hover:bg-accent"
          >
            Browse Gallery
          </Link>
        </div>
      </div>
    )
  }

  // Logged in — show dashboard
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, description, status, page_count, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">AlefBook</h1>
        <div className="flex items-center gap-4">
          <Link href="/gallery" className="text-sm text-muted-foreground hover:text-foreground">
            Gallery
          </Link>
          <SignOutButton />
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold">My Books</h2>
          <Link
            href="/project/new"
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            New Book
          </Link>
        </div>

        {projects && projects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/project/${p.id}`}
                className="block rounded-lg border p-4 hover:border-primary/50 transition-colors"
              >
                <h3 className="font-semibold truncate">{p.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {p.page_count} pages &middot; {p.status}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Updated {new Date(p.updated_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <p>No books yet. Create your first one!</p>
          </div>
        )}
      </main>
    </div>
  )
}

function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="POST">
      <button className="text-sm text-muted-foreground hover:text-foreground">
        Sign Out
      </button>
    </form>
  )
}
