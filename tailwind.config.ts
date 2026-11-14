import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#eef1f8',
          100: '#d4dbed',
          200: '#a9b7da',
          300: '#7e93c8',
          400: '#536fb5',
          500: '#2e4f9e',
          600: '#1a3474',
          700: '#112354',
          800: '#0a1634',
          900: '#050c1f',
        },
        gold: {
          50:  '#fdf8ec',
          100: '#f9edcc',
          200: '#f3d999',
          300: '#edca6a',
          400: '#e6b83e',
          500: '#c9a02a',
          600: '#a07e1e',
          700: '#765d14',
          800: '#4d3d0d',
          900: '#261e06',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // QBR Deck UI refresh — additive presentation tokens only. Nothing
      // existing references these; they back the scoped .qd-* classes in
      // app/globals.css.
      boxShadow: {
        'qd-xs': '0 1px 2px 0 rgb(16 24 40 / 0.04)',
        'qd-sm': '0 1px 3px 0 rgb(16 24 40 / 0.06), 0 1px 2px -1px rgb(16 24 40 / 0.04)',
      },
    },
  },
  plugins: [],
}

export default config
