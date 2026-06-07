/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@react-pdf/renderer', 'pptxgenjs'],
  },
  images: {
    domains: ['img.clerk.com'],
  },
}

module.exports = nextConfig
