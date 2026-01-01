import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3'
import App from './App.jsx'
import './index.css'

// IMPORTANT: process.env is injected by vite.config.js
const siteKey = process.env.VITE_RECAPTCHA_SITE_KEY;
console.log('[reCAPTCHA] Site Key Status:', siteKey ? 'LOADED' : 'MISSING');

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        {siteKey ? (
            <GoogleReCaptchaProvider reCaptchaKey={siteKey}>
                <App />
            </GoogleReCaptchaProvider>
        ) : (
            <App />
        )}
    </React.StrictMode>,
)
