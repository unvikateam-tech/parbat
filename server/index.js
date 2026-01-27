const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();

// --- 1. Security Headers ---
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "'unsafe-inline'", "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
            "frame-src": ["'self'", "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
        },
    },
}));
app.disable('x-powered-by');

// --- 2. CORS Configuration ---
const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:5173', 'http://localhost:3000'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    credentials: true
}));

app.use(express.json({ limit: '10kb' })); // Limit body size to prevent DoS

// --- 3. Rate Limiting ---
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const subscribeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 subscription attempts per hour
    message: { error: 'Too many subscription attempts. Please try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 verification attempts per 15 mins
    message: { error: 'Too many verification attempts. Please wait 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// VERSION TAG
const VERSION = "5.0.0 - Secure Monolith";

// --- 4. Database Setup ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20, // Connection pool limit
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

const initDB = async () => {
    try {
        const client = await pool.connect();
        await client.query(`
            CREATE TABLE IF NOT EXISTS subscribers (
                id SERIAL PRIMARY KEY, 
                email TEXT UNIQUE NOT NULL, 
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS pending_verifications (
                email TEXT PRIMARY KEY, 
                otp_hash TEXT NOT NULL, 
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_pending_expires ON pending_verifications(expires_at);
        `);
        console.log(`[SYSTEM] Core ${VERSION} active.`);
        console.log('[SYSTEM] Database tables verified.');
        client.release();
    } catch (err) {
        console.error('[DB FATAL ERROR]:', err.message);
        process.exit(1);
    }
};
initDB();

// --- 5. Helper Functions ---
const validateEmail = (email) => {
    if (typeof email !== 'string') return null;
    const normalized = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(normalized) ? normalized : null;
};

const verifyRecaptcha = async (token) => {
    if (!process.env.RECAPTCHA_SECRET_KEY) return true; // Skip if not configured
    if (process.env.NODE_ENV !== 'production' && token === 'test-token') return true;

    try {
        const response = await axios.post('https://www.google.com/recaptcha/api/siteverify',
            new URLSearchParams({
                secret: process.env.RECAPTCHA_SECRET_KEY,
                response: token
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        return response.data.success && (response.data.score === undefined || response.data.score >= 0.5);
    } catch (error) {
        console.error('[SECURITY] reCAPTCHA verify error:', error.message);
        return false;
    }
};

// --- 6. API ROUTES ---
app.get('/api/health', apiLimiter, (req, res) => {
    res.json({ status: 'ok', version: VERSION });
});

app.post('/api/subscribe', subscribeLimiter, async (req, res) => {
    const { email, recaptchaToken } = req.body;

    // 1. Validation
    const normalizedEmail = validateEmail(email);
    if (!normalizedEmail) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
    }

    // 2. Anti-bot check
    const isHuman = await verifyRecaptcha(recaptchaToken);
    if (!isHuman) {
        return res.status(403).json({ error: 'Security check failed. Please try again.' });
    }

    try {
        // 3. Cleanup expired tokens
        await pool.query('DELETE FROM pending_verifications WHERE expires_at < NOW()');

        // 4. Check existing sub
        const checkSub = await pool.query('SELECT 1 FROM subscribers WHERE email = $1', [normalizedEmail]);
        if (checkSub.rowCount > 0) {
            return res.status(400).json({ error: 'This email is already verified and subscribed!' });
        }

        // 5. Generate Secure OTP
        const otp = crypto.randomInt(100000, 999999).toString();
        const otpHash = await bcrypt.hash(otp, 10);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

        // 6. DB Transaction for OTP
        await pool.query(
            'INSERT INTO pending_verifications (email, otp_hash, expires_at) VALUES ($1, $2, $3) ON CONFLICT (email) DO UPDATE SET otp_hash = $2, expires_at = $3',
            [normalizedEmail, otpHash, expiresAt]
        );

        // 7. Send Email via Brevo REST API
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <body style="background-color: #0a0a0a; color: #ffffff; font-family: sans-serif; padding: 40px;">
                <div style="background: #111111; border: 1px solid #333333; padding: 40px; max-width: 450px; margin: 0 auto;">
                    <p style="color: #FF6B6B; font-family: monospace; font-size: 12px; text-transform: uppercase;">verification_required</p>
                    <h1 style="color: white;">Join the cohort</h1>
                    <p style="color: #a1a1aa;">Input this token to join parbat_</p>
                    <div style="background: #000000; border: 1px solid #FF6B6B; color: #ffffff; font-family: monospace; font-size: 36px; padding: 25px; text-align: center; margin-top: 20px; letter-spacing: 10px;">${otp}</div>
                </div>
            </body>
            </html>
        `;

        await axios.post('https://api.brevo.com/v3/smtp/email', {
            sender: { name: "Parbat", email: process.env.FROM_EMAIL },
            to: [{ email: normalizedEmail }],
            subject: 'Verification Code - Parbat',
            htmlContent: emailHtml
        }, {
            headers: {
                'api-key': process.env.BREVO_API_KEY || process.env.SMTP_PASS,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        console.log(`[SUBSCRIPTION] OTP sent to ${normalizedEmail}`);
        res.status(200).json({ message: 'Verification code sent to your email.' });

    } catch (error) {
        console.error('[SUBSCRIBE ERROR]:', error.message);
        // Do not leak internal error details to the client
        res.status(500).json({ error: 'An error occurred. Please try again later.' });
    }
});

app.post('/api/verify', verifyLimiter, async (req, res) => {
    const { email, otp } = req.body;

    const normalizedEmail = validateEmail(email);
    if (!normalizedEmail || typeof otp !== 'string' || otp.length !== 6) {
        return res.status(400).json({ error: 'Invalid email or code format.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const verifyRes = await client.query(
            'SELECT otp_hash, expires_at FROM pending_verifications WHERE email = $1',
            [normalizedEmail]
        );

        if (verifyRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No pending verification found for this email.' });
        }

        const { otp_hash, expires_at } = verifyRes.rows[0];

        // 1. Check expiration
        if (new Date() > new Date(expires_at)) {
            await client.query('DELETE FROM pending_verifications WHERE email = $1', [normalizedEmail]);
            await client.query('COMMIT');
            return res.status(400).json({ error: 'Verification code has expired.' });
        }

        // 2. Verify OTP hash
        const isValid = await bcrypt.compare(otp, otp_hash);
        if (!isValid) {
            await client.query('ROLLBACK');
            // We don't delete on first fail to allow user to retry until rate limit hits
            return res.status(400).json({ error: 'Invalid verification code.' });
        }

        // 3. Complete subscription
        await client.query('DELETE FROM pending_verifications WHERE email = $1', [normalizedEmail]);
        await client.query('INSERT INTO subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING', [normalizedEmail]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'Welcome to the cohort! Verification successful.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[VERIFY ERROR]:', error.message);
        res.status(500).json({ error: 'Verification failed. Please try again.' });
    } finally {
        client.release();
    }
});

// --- 7. Static Files & Catch-all ---
const publicPath = path.join(__dirname, '../client/dist');
app.use(express.static(publicPath, {
    maxAge: '1d', // Cache static assets
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

app.get('{*path}', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'), (err) => {
        if (err) {
            res.status(404).json({ error: 'Static files not found. Ensure the client is built.' });
        }
    });
});

// --- 8. Server Startup ---
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`[SYSTEM] Secure Monolith Online on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        pool.end();
        console.log('HTTP server closed');
    });
});
