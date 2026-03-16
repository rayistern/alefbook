/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.in',
      },
    ],
  },
  webpack: (config) => {
    // react-pdf worker
    config.resolve.alias.canvas = false
    return config
  },
}

export default nextConfig
