import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { TooltipProvider } from '@/components/ui/tooltip'
import './globals.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'AlefBook — Design Your Haggadah',
  description: 'Create a personalized Passover Haggadah with AI-powered design tools.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <ClerkProvider appearance={{
        variables: {
          colorBackground: '#121212',
          colorText: '#f5f5f5',
          colorPrimary: '#d4a843',
          colorInputBackground: '#1f1f1f',
          colorInputText: '#f5f5f5',
        },
      }}>
      <html lang="en" className="dark">
        <body className="scrollbar-thin">
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
