import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';

// Setup API base URL - using env var for production, fallback to relative for proxy
const API_BASE = import.meta.env.VITE_API_URL || '';
const api = axios.create({
    baseURL: API_BASE
});

function App() {
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [step, setStep] = useState(0); // 0: Email, 1: OTP, 2: Success
    const [status, setStatus] = useState({ type: '', message: '' });
    const [isLoading, setIsLoading] = useState(false);

    const { executeRecaptcha } = useGoogleReCaptcha();

    const validateEmail = (email) => {
        return String(email)
            .toLowerCase()
            .match(
                /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
            );
    };

    const handleSubscribe = async (e) => {
        e.preventDefault();

        if (!email) {
            setStatus({ type: 'error', message: 'Email is required.' });
            return;
        }

        if (!validateEmail(email)) {
            setStatus({ type: 'error', message: 'Please enter a valid email address.' });
            return;
        }

        setIsLoading(true);
        setStatus({ type: '', message: '' });

        try {
            // Check if reCAPTCHA is available
            if (!executeRecaptcha) {
                console.error('reCAPTCHA not loaded yet');
                setStatus({ type: 'error', message: 'Security check is loading. Please wait a second.' });
                setIsLoading(false);
                return;
            }

            setStatus({ type: 'info', message: 'Shielding: Verifying interaction...' });

            const recaptchaToken = await executeRecaptcha('subscribe');

            if (!recaptchaToken) {
                throw new Error('Security check could not be completed.');
            }

            setStatus({ type: 'info', message: 'Security verified. Sending code...' });

            const response = await api.post('/api/subscribe', { email, recaptchaToken });

            // Success Step 1
            setStatus({ type: 'info', message: 'Verification code sent to ' + email });
            setStep(1);

            // Auto hide info message
            setTimeout(() => {
                setStatus(prev => prev.message.includes('sent') ? { type: '', message: '' } : prev);
            }, 5000);

        } catch (error) {
            console.error('Subscription error:', error);
            let errorMsg = 'An unexpected error occurred.';

            if (error.response) {
                errorMsg = error.response.data?.error || 'Server rejected request.';
            } else if (error.request) {
                errorMsg = 'Cannot reach the server. Is the backend running?';
            } else {
                errorMsg = error.message;
            }

            setStatus({ type: 'error', message: errorMsg });
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async (e) => {
        e.preventDefault();
        if (!otp) return;

        setIsLoading(true);
        setStatus({ type: '', message: '' });

        try {
            const response = await api.post('/api/verify', { email, otp });
            // This is the ONLY place 'Successfully Verified' should appear
            setStatus({ type: 'success', message: response.data.message });
            setStep(2);
            setEmail('');
            setOtp('');
        } catch (error) {
            console.error('OTP Error:', error);
            setStatus({
                type: 'error',
                message: error.response?.data?.error || 'Verification failed. Try again.'
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="app-container" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

            {/* Top Left Logo */}
            <div className="logo-container">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.6 }}
                    style={{ fontWeight: 800, fontSize: '1.25rem', letterSpacing: '-0.05em', textTransform: 'uppercase' }}
                >
                    parbat<span className="text-accent">_</span>
                </motion.div>
            </div>

            <section className="hero-section" style={{ minHeight: '100vh', justifyContent: 'center' }}>
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                >
                    <div className="newsletter-card">
                        <span className="mono-label" style={{ marginBottom: '1rem' }}>newsletter_v2.0</span>

                        <AnimatePresence mode="wait">
                            {step === 0 && (
                                <motion.div
                                    key="step0"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                >
                                    <h3 style={{ marginBottom: '2rem', fontSize: '1.5rem', fontWeight: 700, textAlign: 'left' }}>Join the Journey</h3>
                                    <form onSubmit={handleSubscribe} className="input-group">
                                        <input
                                            type="email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder="your@email.com"
                                            className="newsletter-input"
                                            required
                                        />
                                        <button type="submit" className="btn-newsletter" disabled={isLoading}>
                                            {isLoading ? 'Processing...' : 'Notify Me'}
                                        </button>
                                    </form>
                                </motion.div>
                            )}

                            {step === 1 && (
                                <motion.div
                                    key="step1"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                >
                                    <h3 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 700, textAlign: 'left' }}>Verify Email</h3>
                                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                                        Enter the 6-digit code sent to {email}
                                    </p>
                                    <form onSubmit={handleVerifyOtp} className="input-group">
                                        <input
                                            type="text"
                                            value={otp}
                                            onChange={(e) => setOtp(e.target.value)}
                                            placeholder="XXXXXX"
                                            className="newsletter-input"
                                            maxLength={6}
                                            style={{ textAlign: 'center', letterSpacing: '0.5em', fontSize: '1.25rem' }}
                                            required
                                        />
                                        <button type="submit" className="btn-newsletter" disabled={isLoading}>
                                            {isLoading ? 'Verifying...' : 'Verify & Join'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStep(0)}
                                            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', cursor: 'pointer', marginTop: '1rem', textDecoration: 'underline' }}
                                        >
                                            Change Email
                                        </button>
                                    </form>
                                </motion.div>
                            )}

                            {step === 2 && (
                                <motion.div
                                    key="step2"
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    style={{ textAlign: 'center', padding: '2rem 0' }}
                                >
                                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
                                    <h3 style={{ marginBottom: '1rem', fontSize: '1.5rem', fontWeight: 700 }}>You're in!</h3>
                                    <p style={{ color: 'var(--text-secondary)' }}>Welcome to the cohort. We'll be in touch soon.</p>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {status.message && step !== 2 && (
                            <motion.p
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                style={{
                                    marginTop: '1.5rem',
                                    color: status.type === 'success' ? '#4ade80' :
                                        status.type === 'info' ? '#60a5fa' : '#f87171',
                                    fontSize: '0.875rem',
                                    fontWeight: 500,
                                    textAlign: 'center'
                                }}
                            >
                                {status.message}
                            </motion.p>
                        )}
                    </div>
                </motion.div>
            </section>
        </div>
    );
}

export default App;
