/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./index.html",
        "./src/renderer/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                gray: {
                    850: '#1f2937',
                    950: '#0d1117'
                }
            },
            animation: {
                'fade-in': 'fadeIn 0.2s ease',
                'slide-in': 'slideIn 0.2s ease',
            }
        },
    },
    plugins: [],
}
