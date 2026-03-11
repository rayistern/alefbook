import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { BookOpen, Sparkles, Printer } from 'lucide-react'

export default async function HomePage() {
  const { userId } = await auth()

  if (userId) {
    redirect('/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Nav */}
      <header className="border-b border-border/50">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Image
            src="/images/LOGO11B-2X1.png"
            alt="AlefBook"
            width={140}
            height={70}
            className="h-10 w-auto"
            priority
          />
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild>
              <Link href="/sign-in">Sign In</Link>
            </Button>
            <Button asChild>
              <Link href="/sign-up">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <Image
            src="/images/LOGO11B-2X1.png"
            alt="AlefBook"
            width={280}
            height={140}
            className="mx-auto mb-8 h-24 w-auto"
            priority
          />
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Design Your Personalized{' '}
            <span className="text-gradient-gold">Haggadah</span>
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">
            Create a beautiful, custom Passover Haggadah with AI-powered design tools.
            Add your family photos, personalize the text, and order a professionally printed copy.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Button size="lg" asChild className="text-base px-8">
              <Link href="/sign-up">Start Designing</Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="text-base px-8">
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </div>
        </div>

        {/* Feature cards */}
        <div className="mx-auto mt-24 grid max-w-4xl gap-6 sm:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-semibold">AI-Powered Design</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Describe what you want and our AI will design it. Change colors, fonts, layouts, and more with natural language.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-semibold">82 Beautiful Pages</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Complete Hebrew-English Haggadah with traditional liturgy, songs, activities, and space for your family photos.
            </p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Printer className="h-5 w-5 text-primary" />
            </div>
            <h3 className="font-semibold">Professional Printing</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Order high-quality printed copies delivered to your door, ready for your Passover Seder table.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-6 text-center text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} AlefBook. All rights reserved.</p>
      </footer>
    </div>
  )
}
