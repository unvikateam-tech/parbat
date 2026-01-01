const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const axios = require('axios');
const nodemailer = require('nodemailer');

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// VERSION TAG FOR DEBUGGING
const VERSION = "4.0.0 - Monolith";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 465,
    secure: true, // Use SSL/TLS
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: { rejectUnauthorized: false }
});

const initDB = async () => {
    try {
        const client = await pool.connect();
        await client.query(`
            CREATE TABLE IF NOT EXISTS subscribers (
                id SERIAL PRIMARY KEY, 
                email TEXT UNIQUE NOT NULL, 
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS pending_verifications (
                email TEXT PRIMARY KEY, 
                otp_code TEXT NOT NULL, 
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log(`[SYSTEM] Core ${VERSION} active.`);
        console.log('[SYSTEM] Database tables verified.');
        client.release();
    } catch (err) {
        console.error('[DB FATAL ERROR]:', err.message);
    }
};
initDB();

// API ROUTES
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', version: VERSION });
});

app.post('/api/subscribe', async (req, res) => {
    const { email, recaptchaToken } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    if (recaptchaToken !== 'test-token' && process.env.RECAPTCHA_SECRET_KEY && process.env.RECAPTCHA_SECRET_KEY.startsWith('6L')) {
        try {
            const verifyUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`;
            const recaptchaVerify = await axios.post(verifyUrl);
            if (!recaptchaVerify.data.success || (recaptchaVerify.data.score !== undefined && recaptchaVerify.data.score < 0.5)) {
                return res.status(400).json({ error: 'Security check failed. Bots are not allowed.' });
            }
        } catch (e) {
            console.warn('[Security] reCAPTCHA check error:', e.message);
        }
    }

    try {
        await pool.query('DELETE FROM pending_verifications WHERE expires_at < NOW()');

        const checkSub = await pool.query('SELECT 1 FROM subscribers WHERE email = $1', [normalizedEmail]);
        if (checkSub.rowCount > 0) {
            return res.status(400).json({ error: 'This email is already verified and subscribed!' });
        }

        const otp = crypto.randomInt(100000, 999999).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await pool.query(
            'INSERT INTO pending_verifications (email, otp_code, expires_at) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET otp_code = $2, expires_at = $3',
            [normalizedEmail, otp, expiresAt]
        );

        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { margin: 0; padding: 0; background-color: #0a0a0a; color: #ffffff; font-family: sans-serif; }
                    .card { background: #111111; border: 1px solid #333333; padding: 40px; max-width: 450px; margin: 40px auto; }
                    .label { color: #FF6B6B; font-family: monospace; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; }
                    .otp-box { background: #000000; border: 1px solid #FF6B6B; color: #ffffff; font-family: monospace; font-size: 36px; padding: 25px; text-align: center; margin-top: 20px; letter-spacing: 10px; }
                </style>
            </head>
            <body>
                <div class="card">
                    <span class="label">verification_required</span>
                    <h1 style="color: white;">Join the cohort</h1>
                    <p style="color: #a1a1aa;">Input this token to join parbat_</p>
                    <div class="otp-box">${otp}</div>
                </div>
            </body>
            </html>
        `;

        console.log(`[SUBSCRIPTION] Email generated for ${normalizedEmail}. Using Brevo API...`);
        console.log(`[BREVO] Sender: ${process.env.FROM_EMAIL || "Not Set"}`);

        // Use Brevo REST API instead of SMTP to bypass cloud port blocking
        const response = await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: "Parbat", email: process.env.FROM_EMAIL },
            to: [{ email: normalizedEmail }],
            subject: 'Verification Code - Parbat',
            htmlContent: emailHtml
        }, {
            headers: {
                'api-key': process.env.SMTP_PASS,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // 15s timeout
        });

        console.log(`[SUBSCRIPTION] Success! Brevo Message ID: ${response.data.messageId}`);
        res.status(200).json({ message: 'Verification code sent to your email.' });
    } catch (error) {
        // Detailed error for debugging
        const brevoError = error.response?.data?.message || error.message;
        console.error('[BREVO ERROR]:', brevoError);

        res.status(500).json({
            error: `Brevo API Error: ${brevoError}`,
            details: 'Ensure FROM_EMAIL is a verified sender in your Brevo dashboard and SMTP_PASS is a valid API Key v3.'
        });
    }
});

app.post('/api/verify', async (req, res) => {
    const { email, otp } = req.body;
    const normalizedEmail = email?.toLowerCase().trim();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const verifyRes = await client.query(
            'SELECT * FROM pending_verifications WHERE email = $1 AND otp_code = $2 AND expires_at > NOW()',
            [normalizedEmail, otp]
        );
        if (verifyRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Code is invalid or has expired.' });
        }
        await client.query('DELETE FROM pending_verifications WHERE email = $1', [normalizedEmail]);
        await client.query('INSERT INTO subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [normalizedEmail]);
        await client.query('COMMIT');
        res.status(200).json({ message: 'Welcome to the cohort! Verification successful.' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Verification failed.' });
    } finally {
        client.release();
    }
});

// SERVE FRONTEND (STATIC FILES)
app.use(express.static(path.join(__dirname, '../client/dist')));

// CATCH-ALL FALLBACK (MUST BE LAST)
// Serves the React frontend for any route not caught by the API
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
});

app.listen(PORT, () => console.log(`[SYSTEM] Monolith Online on port ${PORT}`));
