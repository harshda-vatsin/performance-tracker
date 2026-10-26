/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Single accent colour (forge-ember orange). Change here to re-theme the whole app.
        accent: {
          50: '#fff4ed',
          100: '#ffe6d5',
          200: '#fecaaa',
          300: '#fda574',
          400: '#fb773c',
          500: '#f95616',
          600: '#ea3d0c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
