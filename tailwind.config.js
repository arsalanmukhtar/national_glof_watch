/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#e8ecf5',
          100: '#c7d0e6',
          200: '#9babcf',
          300: '#7184b8',
          400: '#4f66a6',
          500: '#304a91',
          600: '#1f3a82',
          700: '#0e2873',
          800: '#062063',
          900: '#002060',
          950: '#001340',
        },
        day: {
          bg: '#f8fafc',
          surface: '#ffffff',
          border: '#e2e8f0',
          text: '#0f172a',
          muted: '#64748b',
        },
        night: {
          bg: '#1e272e',
          surface: '#2a333a',
          border: '#3a444c',
          text: '#e5e7eb',
          muted: '#9aa5b1',
        },
        accent: {
          teal: '#14b8a6',
          amber: '#f59e0b',
          orange: '#e67e22',
          danger: '#ef4444',
          success: '#22c55e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Preset scale bumped +1px from Tailwind defaults so semantic
      // utilities (text-xs / text-sm / …) read alongside the +1px bump
      // we did on every arbitrary `text-[Npx]`. Line-heights stay at
      // their original absolute values so element heights (which often
      // get implicit leading from these pairs) don't reflow.
      fontSize: {
        xs:   ['0.8125rem', { lineHeight: '1rem' }],     // 13px / 16
        sm:   ['0.9375rem', { lineHeight: '1.25rem' }],  // 15px / 20
        base: ['1.0625rem', { lineHeight: '1.5rem' }],   // 17px / 24
        lg:   ['1.1875rem', { lineHeight: '1.75rem' }],  // 19px / 28
        xl:   ['1.3125rem', { lineHeight: '1.75rem' }],  // 21px / 28
        '2xl':['1.5625rem', { lineHeight: '2rem' }],     // 25px / 32
        '3xl':['1.9375rem', { lineHeight: '2.25rem' }],  // 31px / 36
        '4xl':['2.3125rem', { lineHeight: '2.5rem' }],   // 37px / 40
        '5xl':['3.0625rem', { lineHeight: '1' }],        // 49px
        '6xl':['3.8125rem', { lineHeight: '1' }],        // 61px
      },
      boxShadow: {
        card: '0 1px 3px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
        panel: '0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.04)',
        titlebar: '0 2px 8px rgba(0, 32, 96, 0.25)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.4s ease-out',
        'slide-down': 'slide-down 0.4s ease-out',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};
