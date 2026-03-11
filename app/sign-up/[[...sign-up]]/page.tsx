import { SignUp } from '@clerk/nextjs'
import Image from 'next/image'

export default function SignUpPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-8">
      <Image
        src="/images/LOGO11B-2X1.png"
        alt="AlefBook"
        width={180}
        height={90}
        className="h-14 w-auto"
      />
      <SignUp />
    </div>
  )
}
