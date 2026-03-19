import { createServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server'
import Link from 'next/link'

export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gradient-bg-subtle">
        <h1 className="text-4xl font-bold gradient-text">Shluchim Exchange</h1>
        <p className="text-muted-foreground mt-2">AI-powered book creation</p>
        <p className="text-sm text-muted-foreground mt-4">Service not configured.</p>
      </div>
    )
  }

  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return <LandingPage />
  }

  // Logged in — show dashboard
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, description, status, page_count, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  return <Dashboard projects={projects ?? []} />
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="https://www.shluchimexchange.ai/logo.png" alt="Shluchim Exchange" className="w-8 h-8 rounded-lg object-contain" />
            <span className="text-lg font-bold">Shluchim Exchange</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/gallery"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Gallery
            </Link>
            <Link
              href="/auth/login"
              className="rounded-full gradient-bg px-5 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/25"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-6 overflow-hidden">
        {/* Background decoration */}
        <div className="absolute inset-0 gradient-bg-subtle" />
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-purple-300/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-300/20 rounded-full blur-3xl" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-white border border-purple-200 px-4 py-1.5 text-sm text-purple-700 mb-8 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
            Powered by AI
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.1]">
            Create beautiful books
            <span className="block gradient-text">with AI</span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Choose a template, describe your vision, and let AI craft your perfect book.
            No design skills needed — just your ideas.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/login"
              className="rounded-full gradient-bg px-8 py-3 text-base font-medium text-white hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/25"
            >
              Start Creating — Free
            </Link>
            <Link
              href="/gallery"
              className="rounded-full border border-purple-200 bg-white px-8 py-3 text-base font-medium text-purple-700 hover:bg-purple-50 transition-colors"
            >
              Browse Gallery
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">How it works</h2>
          <p className="text-center text-muted-foreground mb-16 max-w-lg mx-auto">
            Three simple steps to go from idea to a professionally formatted book.
          </p>

          <div className="grid sm:grid-cols-3 gap-8">
            <FeatureCard
              step="1"
              title="Pick a template"
              description="Start with a professionally designed template — blank books, bilingual layouts, and more."
            />
            <FeatureCard
              step="2"
              title="Chat with AI"
              description="Describe what you want in plain language. Add content, change styles, insert images — just ask."
            />
            <FeatureCard
              step="3"
              title="Download your book"
              description="Get a polished PDF ready to print or share. Make changes anytime — your book is always editable."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 gradient-bg-subtle">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to create?</h2>
          <p className="text-muted-foreground mb-8">
            Join creators making beautiful books with the power of AI.
          </p>
          <Link
            href="/auth/login"
            className="inline-block rounded-full gradient-bg px-8 py-3 text-base font-medium text-white hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/25"
          >
            Get Started — Free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <img src="https://www.shluchimexchange.ai/logo.png" alt="Shluchim Exchange" className="w-5 h-5 rounded object-contain" />
            <span>Shluchim Exchange</span>
          </div>
          <p>Create books with AI</p>
        </div>
      </footer>
    </div>
  )
}

function FeatureCard({ step, title, description }: { step: string; title: string; description: string }) {
  return (
    <div className="relative p-6 rounded-2xl bg-white border border-purple-100 hover:border-purple-200 transition-colors hover:shadow-lg hover:shadow-purple-500/5">
      <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center text-white font-bold text-sm mb-4">
        {step}
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </div>
  )
}

interface DashboardProject {
  id: string
  name: string
  description: string
  status: string
  page_count: number
  updated_at: string
}

function Dashboard({ projects }: { projects: DashboardProject[] }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="https://www.shluchimexchange.ai/logo.png" alt="Shluchim Exchange" className="w-8 h-8 rounded-lg object-contain" />
            <span className="text-lg font-bold">Shluchim Exchange</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/gallery" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Gallery
            </Link>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold">My Books</h2>
            <p className="text-sm text-muted-foreground mt-1">Create and manage your book projects</p>
          </div>
          <Link
            href="/project/new"
            className="rounded-full gradient-bg px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/25"
          >
            + New Book
          </Link>
        </div>

        {projects && projects.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/project/${p.id}`}
                className="group block rounded-2xl border border-purple-100 bg-white p-5 hover:border-purple-300 hover:shadow-lg hover:shadow-purple-500/5 transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-xl gradient-bg-subtle flex items-center justify-center">
                    <span className="text-purple-600 font-bold text-sm">
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    p.status === 'ready'
                      ? 'bg-green-50 text-green-700'
                      : p.status === 'error'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-purple-50 text-purple-700'
                  }`}>
                    {p.status === 'ready' ? 'Ready' : p.status === 'error' ? 'Needs attention' : p.status}
                  </span>
                </div>
                <h3 className="font-semibold mt-3 truncate group-hover:text-purple-700 transition-colors">{p.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {p.page_count} pages
                </p>
                <p className="text-xs text-muted-foreground mt-3">
                  Updated {new Date(p.updated_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl gradient-bg-subtle flex items-center justify-center mx-auto mb-4">
              <span className="text-purple-600 text-2xl">+</span>
            </div>
            <p className="text-muted-foreground font-medium">No books yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first book to get started</p>
            <Link
              href="/project/new"
              className="inline-block mt-6 rounded-full gradient-bg px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity shadow-lg shadow-purple-500/25"
            >
              Create your first book
            </Link>
          </div>
        )}
      </main>
    </div>
  )
}

function SignOutButton() {
  return (
    <form action="/api/auth/signout" method="POST">
      <button className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        Sign Out
      </button>
    </form>
  )
}
