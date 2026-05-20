/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'sc-navy':    '#1E3A5F',
        'sc-primary': '#3B6B9C',
        'sc-light-blue': '#ebf1f7',
        'sc-gold':    '#8B6F47',
        'sc-bg':      '#f8f9fa',
        'sc-text':    '#1f2937',
        'sc-text-secondary': '#4b5563',
        'sc-text-muted':     '#9ca3af',
        'sc-border':  '#eeeeee',
        'sc-border-strong': '#d1d5db',
        'sc-success': '#16a34a',
        'sc-success-bg': '#dcfce7',
        'sc-warning': '#d97706',
        'sc-warning-bg': '#fef3c7',
        'sc-danger':  '#dc2626',
        'sc-danger-bg':  '#fee2e2',
      },
      fontFamily: {
        sans: ['Heebo', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'sc-card':  '14px',
        'sc-input': '10px',
        'sc-pill':  '9999px',
        'sc-btn':   '10px',
      },
    },
  },
  plugins: [],
}
