import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default async function HomePage() {
  const { userId } = await auth()

  if (userId) {
    redirect('/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">AlefBook</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Design your personalized Passover Haggadah with AI
        </p>
      </div>
      <div className="flex gap-4">
        <Button asChild>
          <Link href="/sign-up">Get Started</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/sign-in">Sign In</Link>
        </Button>
      </div>
    </div>
  )
}
