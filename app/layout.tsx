import type { Metadata } from 'next'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'AlefBook — AI Book Creator',
  description: 'Create and customize beautiful books with AI. Choose a template, describe your vision, and watch it come to life.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>
        <TooltipProvider>
          {children}
        </TooltipProvider>
      </body>
    </html>
  )
}
