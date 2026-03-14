#!/usr/bin/env node

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const PAYMENT_MODE = (process.env.PAYMENT_MODE || 'manual').toLowerCase();
const MANUAL_VIPPS_NUMBER = process.env.MANUAL_VIPPS_NUMBER || '97908575';
const VIPPS_ENV = (process.env.VIPPS_ENV || 'test').toLowerCase();
const VIPPS_AUTO_CAPTURE = (process.env.VIPPS_AUTO_CAPTURE || 'true').toLowerCase() === 'true';

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS || 1000 * 60 * 60 * 24 * 7);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const TOKEN_ENDPOINT =
  VIPPS_ENV === 'production'
    ? 'https://api.vipps.no/accesstoken/get'
    : 'https://apitest.vipps.no/accesstoken/get';
const EPAYMENT_BASE_URL =
  VIPPS_ENV === 'production' ? 'https://api.vipps.no/epayment/v1' : 'https://apitest.vipps.no/epayment/v1';

const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const STRINGERS_FILE = path.join(DATA_DIR, 'stringers.json');
const CONTACT_MESSAGES_FILE = path.join(DATA_DIR, 'contact-messages.json');
const AUTH_DB_FILE = path.join(DATA_DIR, 'auth.db');
const PUBLIC_DIR = path.join(__dirname, 'public');

ensureDataFiles();
const authDb = openAuthDb();

const app = express();

if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.sqlite',
      dir: DATA_DIR
    }),
    name: 'stringr.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PRODUCTION,
      maxAge: SESSION_MAX_AGE_MS
    }
  })
);

app.post(
  '/api/register',
  asyncHandler(async (req, res) => {
    const normalized = normalizeAndValidateRegistration(req.body || {});

    const existing = await findUserByEmail(normalized.email);
    if (existing) {
      return res.status(409).json({ error: 'E-post er allerede registrert.' });
    }

    const passwordHash = await bcrypt.hash(normalized.password, 12);
    const createdAt = new Date().toISOString();

    const result = await dbRun(
      authDb,
      `INSERT INTO users (name, email, password_hash, created_at)
       VALUES (?, ?, ?, ?)`,
      [normalized.name, normalized.email, passwordHash, createdAt]
    );

    req.session.userId = result.lastID;

    return res.status(201).json({
      user: {
        id: result.lastID,
        name: normalized.name,
        email: normalized.email,
        createdAt
      }
    });
  })
);

app.post(
  '/api/login',
  asyncHandler(async (req, res) => {
    const email = sanitizeEmail(req.body?.email);
    const password = sanitizeLoginPassword(req.body?.password);

    const userRow = await dbGet(authDb, 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);
    if (!userRow) {
      return res.status(401).json({ error: 'Feil e-post eller passord.' });
    }

    const ok = await bcrypt.compare(password, userRow.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Feil e-post eller passord.' });
    }

    req.session.userId = userRow.id;

    return res.status(200).json({ user: mapUserRow(userRow) });
  })
);

app.post('/api/logout', (req, res) => {
  if (!req.session) {
    return res.status(200).json({ ok: true });
  }

  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({ error: 'Kunne ikke logge ut.' });
    }

    res.clearCookie('stringr.sid');
    return res.status(200).json({ ok: true });
  });
});

app.get(
  '/api/me',
  asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Ikke logget inn.' });
    }

    const userRow = await dbGet(authDb, 'SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!userRow) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Ikke logget inn.' });
    }

    return res.status(200).json({ user: mapUserRow(userRow) });
  })
);

app.post(
  '/api/bookings',
  asyncHandler(async (req, res) => {
    const booking = await createBookingAndPayment(req.body || {});
    return res.status(201).json(booking);
  })
);

app.get(
  '/api/bookings/complete',
  asyncHandler(async (req, res) => {
    const reference = req.query.reference;
    if (!reference) {
      return res.status(400).json({ error: 'Missing reference query parameter.' });
    }

    const result = await completeBooking(reference);
    return res.status(200).json(result);
  })
);

app.get('/api/bookings/status', (req, res) => {
  const reference = req.query.reference;
  if (!reference) {
    return res.status(400).json({ error: 'Missing reference query parameter.' });
  }

  const booking = findBooking(reference);
  if (!booking) {
    return res.status(404).json({ error: 'Booking not found.' });
  }

  return res.status(200).json(booking);
});

app.get('/api/stringers', (req, res) => {
  const stringers = readStringers().map(toPublicStringer);
  return res.status(200).json(stringers);
});

app.get(
  '/api/my-stringer',
  asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Du må være logget inn.' });
    }

    const owner = await dbGet(authDb, 'SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!owner) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Du må være logget inn.' });
    }

    const existing = findLatestStringerByOwnerId(owner.id);
    if (!existing) {
      return res.status(404).json({ error: 'Ingen oppføring funnet.' });
    }

    return res.status(200).json({ stringer: toOwnerStringer(existing) });
  })
);

app.post(
  '/api/stringers',
  asyncHandler(async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Du må være logget inn.' });
    }

    const owner = await dbGet(authDb, 'SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!owner) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Du må være logget inn.' });
    }

    const normalized = normalizeAndValidateStringer(req.body || {}, mapUserRow(owner));
    const existing = findLatestStringerByOwnerId(owner.id);
    const now = new Date().toISOString();

    if (existing) {
      const updated = updateStringerById(existing.id, {
        ...normalized,
        updatedAt: now
      });
      return res.status(200).json(toPublicStringer(updated));
    }

    const stringer = {
      id: crypto.randomUUID(),
      ...normalized,
      createdAt: now,
      updatedAt: now
    };

    appendStringer(stringer);
    return res.status(201).json(toPublicStringer(stringer));
  })
);

app.post(
  '/api/contact',
  asyncHandler(async (req, res) => {
    const normalized = normalizeAndValidateContactMessage(req.body || {});
    const message = {
      id: crypto.randomUUID(),
      name: normalized.name,
      email: normalized.email,
      message: normalized.message,
      createdAt: new Date().toISOString()
    };

    appendContactMessage(message);
    return res.status(201).json({ ok: true });
  })
);

app.get('/api/health', (req, res) => {
  return res.status(200).json({ ok: true, env: VIPPS_ENV, paymentMode: PAYMENT_MODE });
});

app.use(express.static(PUBLIC_DIR));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  const message = error.message || 'Unexpected server error.';
  res.status(statusCode).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`Server running on ${APP_BASE_URL}`);
});

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function createBookingAndPayment(payload) {
  const normalized = normalizeAndValidateBooking(payload);
  const reference = createReference();
  const price = calculatePrice(normalized.hasOwnString);

  const booking = {
    id: crypto.randomUUID(),
    reference,
    customerName: normalized.customerName,
    email: normalized.email,
    phone: normalized.phone,
    racketModel: normalized.racketModel,
    tensionKg: normalized.tensionKg,
    hasOwnString: normalized.hasOwnString,
    notes: normalized.notes,
    amountOere: price.amountOere,
    amountNok: price.amountNok,
    stringChargeNok: price.stringChargeNok,
    paymentMode: PAYMENT_MODE,
    manualVippsNumber: MANUAL_VIPPS_NUMBER,
    status: PAYMENT_MODE === 'vipps' ? 'payment_pending' : 'awaiting_manual_payment',
    vippsState: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (PAYMENT_MODE !== 'vipps') {
    appendBooking(booking);
    return {
      reference: booking.reference,
      amountNok: booking.amountNok,
      status: booking.status,
      paymentMode: booking.paymentMode,
      manualVippsNumber: booking.manualVippsNumber
    };
  }

  validateConfig();

  const accessToken = await getVippsAccessToken();
  const payment = await createVippsPayment({
    accessToken,
    reference,
    amountOere: booking.amountOere,
    description: `Tennis restringing (${booking.tensionKg} kg)`,
    customerPhone: booking.phone
  });

  booking.vippsRedirectUrl = payment.redirectUrl;

  appendBooking(booking);

  return {
    reference: booking.reference,
    amountNok: booking.amountNok,
    redirectUrl: payment.redirectUrl,
    paymentMode: booking.paymentMode
  };
}

async function completeBooking(reference) {
  const booking = findBooking(reference);
  if (!booking) {
    const err = new Error('Booking not found.');
    err.statusCode = 404;
    throw err;
  }

  if (booking.paymentMode !== 'vipps' || PAYMENT_MODE !== 'vipps') {
    const updated = updateBooking(reference, {
      status: booking.status === 'paid' ? 'paid' : 'awaiting_manual_payment',
      updatedAt: new Date().toISOString()
    });

    return {
      reference: updated.reference,
      status: updated.status,
      vippsState: updated.vippsState,
      amountNok: updated.amountNok,
      paymentMode: 'manual',
      manualVippsNumber: updated.manualVippsNumber || MANUAL_VIPPS_NUMBER
    };
  }

  validateConfig();

  const accessToken = await getVippsAccessToken();
  const payment = await getVippsPayment({ accessToken, reference });
  const states = Array.isArray(payment.state)
    ? payment.state
    : typeof payment.state === 'string'
      ? [payment.state]
      : [];
  const aggregate = payment.aggregate || {};
  const capturedAmount = Number(aggregate.capturedAmount?.value || 0);
  const cancelledAmount = Number(aggregate.cancelledAmount?.value || 0);

  let finalStatus = booking.status;
  let latestVippsState = states.length > 0 ? states[states.length - 1] : null;

  if (capturedAmount >= booking.amountOere) {
    finalStatus = 'paid';
    latestVippsState = 'CAPTURED';
  } else if (states.includes('AUTHORIZED')) {
    if (cancelledAmount >= booking.amountOere) {
      finalStatus = 'payment_failed';
      latestVippsState = 'CANCELLED';
    } else if (VIPPS_AUTO_CAPTURE) {
      const amountToCapture = booking.amountOere - capturedAmount;
      if (amountToCapture > 0) {
        await captureVippsPayment({ accessToken, reference, amountOere: amountToCapture });
      }
      latestVippsState = 'CAPTURED';
      finalStatus = 'paid';
    } else {
      latestVippsState = 'AUTHORIZED';
      finalStatus = 'authorized';
    }
  } else if (states.includes('TERMINATED') || states.includes('ABORTED') || states.includes('EXPIRED')) {
    finalStatus = 'payment_failed';
  } else {
    finalStatus = 'payment_pending';
  }

  const updated = updateBooking(reference, {
    status: finalStatus,
    vippsState: latestVippsState,
    updatedAt: new Date().toISOString()
  });

  return {
    reference: updated.reference,
    status: updated.status,
    vippsState: updated.vippsState,
    amountNok: updated.amountNok,
    paymentMode: updated.paymentMode || 'vipps'
  };
}

function normalizeAndValidateBooking(payload) {
  if (!payload || typeof payload !== 'object') {
    throw badRequest('Invalid booking payload.');
  }

  const customerName = sanitizeString(payload.customerName, 2, 80, 'customerName');
  const email = sanitizeEmail(payload.email);
  const phone = sanitizePhone(payload.phone);
  const racketModel = sanitizeOptionalString(payload.racketModel, 0, 80);
  const notes = sanitizeOptionalString(payload.notes, 0, 500);

  const tensionValue = Number(payload.tensionKg);
  if (!Number.isFinite(tensionValue) || tensionValue < 16 || tensionValue > 32) {
    throw badRequest('tensionKg must be a number between 16 and 32.');
  }

  const hasOwnString = parseBoolean(payload.hasOwnString, 'hasOwnString');

  return {
    customerName,
    email,
    phone,
    racketModel,
    notes,
    tensionKg: Number(tensionValue.toFixed(1)),
    hasOwnString
  };
}

function calculatePrice(hasOwnString) {
  const laborNok = 175;
  const stringChargeNok = hasOwnString ? 0 : 125;
  const amountNok = laborNok + stringChargeNok;

  return {
    laborNok,
    stringChargeNok,
    amountNok,
    amountOere: amountNok * 100
  };
}

async function getVippsAccessToken() {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      client_id: requiredEnv('VIPPS_CLIENT_ID'),
      client_secret: requiredEnv('VIPPS_CLIENT_SECRET'),
      'Ocp-Apim-Subscription-Key': requiredEnv('VIPPS_SUBSCRIPTION_KEY'),
      'Merchant-Serial-Number': requiredEnv('VIPPS_MSN')
    }
  });

  if (!response.ok) {
    const message = await safeReadResponse(response);
    throw new Error(`Vipps access token request failed (${response.status}): ${message}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Vipps access token response did not include access_token.');
  }

  return data.access_token;
}

async function createVippsPayment({ accessToken, reference, amountOere, description, customerPhone }) {
  const returnUrl = `${APP_BASE_URL}/complete.html?reference=${encodeURIComponent(reference)}`;
  const payload = {
    amount: {
      currency: 'NOK',
      value: amountOere
    },
    paymentMethod: {
      type: 'WALLET'
    },
    customer: {
      phoneNumber: customerPhone
    },
    reference,
    returnUrl,
    userFlow: 'WEB_REDIRECT',
    paymentDescription: description
  };

  const response = await fetch(`${EPAYMENT_BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': requiredEnv('VIPPS_SUBSCRIPTION_KEY'),
      'Merchant-Serial-Number': requiredEnv('VIPPS_MSN'),
      'Idempotency-Key': crypto.randomUUID(),
      'Vipps-System-Name': 'stringer-booking',
      'Vipps-System-Version': '1.0.0',
      'Vipps-System-Plugin-Name': 'custom-node',
      'Vipps-System-Plugin-Version': process.versions.node
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await safeReadResponse(response);
    throw new Error(`Vipps create payment failed (${response.status}): ${message}`);
  }

  const data = await response.json();

  if (!data.redirectUrl) {
    throw new Error('Vipps payment creation succeeded but redirectUrl was missing.');
  }

  return data;
}

async function getVippsPayment({ accessToken, reference }) {
  const response = await fetch(`${EPAYMENT_BASE_URL}/payments/${encodeURIComponent(reference)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Ocp-Apim-Subscription-Key': requiredEnv('VIPPS_SUBSCRIPTION_KEY'),
      'Merchant-Serial-Number': requiredEnv('VIPPS_MSN')
    }
  });

  if (!response.ok) {
    const message = await safeReadResponse(response);
    throw new Error(`Vipps get payment failed (${response.status}): ${message}`);
  }

  return response.json();
}

async function captureVippsPayment({ accessToken, reference, amountOere }) {
  const response = await fetch(`${EPAYMENT_BASE_URL}/payments/${encodeURIComponent(reference)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': requiredEnv('VIPPS_SUBSCRIPTION_KEY'),
      'Merchant-Serial-Number': requiredEnv('VIPPS_MSN'),
      'Idempotency-Key': crypto.randomUUID()
    },
    body: JSON.stringify({
      modificationAmount: {
        currency: 'NOK',
        value: amountOere
      }
    })
  });

  if (!response.ok) {
    const message = await safeReadResponse(response);
    throw new Error(`Vipps capture failed (${response.status}): ${message}`);
  }

  return true;
}

function findBooking(reference) {
  const bookings = readBookings();
  return bookings.find((item) => item.reference === reference) || null;
}

function appendBooking(booking) {
  const bookings = readBookings();
  bookings.push(booking);
  writeBookings(bookings);
}

function updateBooking(reference, patch) {
  const bookings = readBookings();
  const index = bookings.findIndex((item) => item.reference === reference);

  if (index < 0) {
    const err = new Error('Booking not found for update.');
    err.statusCode = 404;
    throw err;
  }

  bookings[index] = { ...bookings[index], ...patch };
  writeBookings(bookings);

  return bookings[index];
}

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(BOOKINGS_FILE)) {
    fs.writeFileSync(BOOKINGS_FILE, '[]\n', 'utf8');
  }

  if (!fs.existsSync(STRINGERS_FILE)) {
    fs.writeFileSync(STRINGERS_FILE, '[]\n', 'utf8');
  }

  if (!fs.existsSync(CONTACT_MESSAGES_FILE)) {
    fs.writeFileSync(CONTACT_MESSAGES_FILE, '[]\n', 'utf8');
  }
}

function readBookings() {
  try {
    const raw = fs.readFileSync(BOOKINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeBookings(bookings) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(bookings, null, 2) + '\n', 'utf8');
}

function readStringers() {
  try {
    const raw = fs.readFileSync(STRINGERS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeStringers(stringers) {
  fs.writeFileSync(STRINGERS_FILE, JSON.stringify(stringers, null, 2) + '\n', 'utf8');
}

function appendStringer(stringer) {
  const stringers = readStringers();
  stringers.push(stringer);
  writeStringers(stringers);
}

function readContactMessages() {
  try {
    const raw = fs.readFileSync(CONTACT_MESSAGES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeContactMessages(messages) {
  fs.writeFileSync(CONTACT_MESSAGES_FILE, JSON.stringify(messages, null, 2) + '\n', 'utf8');
}

function appendContactMessage(message) {
  const messages = readContactMessages();
  messages.push(message);
  writeContactMessages(messages);
}

function findLatestStringerByOwnerId(ownerUserId) {
  const ownerId = Number(ownerUserId);
  if (!Number.isFinite(ownerId)) {
    return null;
  }

  const stringers = readStringers().filter((item) => Number(item.ownerUserId) === ownerId);
  if (stringers.length === 0) {
    return null;
  }

  stringers.sort((a, b) => {
    const aTime = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    const bTime = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    return bTime - aTime;
  });

  return stringers[0];
}

function updateStringerById(id, patch) {
  const stringers = readStringers();
  const index = stringers.findIndex((item) => item.id === id);
  if (index < 0) {
    const err = new Error('Stringer not found for update.');
    err.statusCode = 404;
    throw err;
  }

  const original = stringers[index];
  stringers[index] = {
    ...original,
    ...patch,
    id: original.id,
    ownerUserId: original.ownerUserId,
    createdAt: original.createdAt
  };
  writeStringers(stringers);
  return stringers[index];
}

function toPublicStringer(stringer) {
  return {
    id: stringer.id,
    businessName: stringer.businessName,
    city: stringer.city,
    fromPrice: stringer.fromPrice,
    waitTime: stringer.waitTime,
    trustSignal: stringer.trustSignal,
    sports: normalizeSportsList(stringer.sports),
    createdAt: stringer.createdAt,
    updatedAt: stringer.updatedAt
  };
}

function toOwnerStringer(stringer) {
  return {
    id: stringer.id,
    businessName: stringer.businessName,
    city: stringer.city,
    ownerName: stringer.ownerName,
    ownerEmail: stringer.ownerEmail,
    phone: stringer.phone,
    fromPrice: stringer.fromPrice,
    waitTime: stringer.waitTime,
    trustSignal: stringer.trustSignal,
    description: stringer.description || '',
    sports: normalizeSportsList(stringer.sports),
    createdAt: stringer.createdAt,
    updatedAt: stringer.updatedAt
  };
}

function openAuthDb() {
  const db = new sqlite3.Database(AUTH_DB_FILE);
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  });
  return db;
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row || null);
    });
  });
}

async function findUserByEmail(email) {
  const row = await dbGet(authDb, 'SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);
  return row ? mapUserRow(row) : null;
}

function mapUserRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.created_at
  };
}

function normalizeAndValidateRegistration(payload) {
  if (!payload || typeof payload !== 'object') {
    throw badRequest('Ugyldig registreringsdata.');
  }

  const name = sanitizeString(payload.name, 2, 120, 'name');
  const email = sanitizeEmail(payload.email);
  const password = sanitizePassword(payload.password);

  return { name, email, password };
}

function sanitizePassword(value) {
  if (typeof value !== 'string') {
    throw badRequest('Passord må være tekst.');
  }

  const password = value.trim();
  if (password.length < 8) {
    throw badRequest('Passord må være minst 8 tegn.');
  }

  if (password.length > 128) {
    throw badRequest('Passord er for langt.');
  }

  return password;
}

function sanitizeLoginPassword(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('Passord mangler.');
  }

  return value.trim();
}

function normalizeAndValidateStringer(payload, owner) {
  if (!payload || typeof payload !== 'object') {
    throw badRequest('Invalid stringer payload.');
  }

  const businessName = sanitizeString(payload.businessName, 2, 120, 'businessName');
  const city = toTitleCase(sanitizeString(payload.city, 2, 80, 'city'));
  const ownerName = sanitizeString(owner.name, 2, 120, 'ownerName');
  const ownerEmail = sanitizeEmail(owner.email);
  const phone = sanitizePhone(payload.phone);
  const trustSignal = sanitizeString(payload.trustSignal, 2, 120, 'trustSignal');
  const waitTime = sanitizeString(payload.waitTime, 2, 60, 'waitTime');
  const description = sanitizeOptionalString(payload.description, 0, 420);

  const fromPrice = Number(payload.fromPrice);
  if (!Number.isFinite(fromPrice) || fromPrice <= 0 || fromPrice > 10000) {
    throw badRequest('fromPrice must be a positive number.');
  }

  if (!Array.isArray(payload.sports) || payload.sports.length === 0) {
    throw badRequest('sports must be a non-empty array.');
  }

  const normalizedSports = normalizeSportsList(payload.sports);
  if (normalizedSports.length === 0) {
    throw badRequest('sports contains no valid values.');
  }

  return {
    businessName,
    city,
    ownerUserId: owner.id,
    ownerName,
    ownerEmail,
    phone,
    fromPrice: Math.round(fromPrice),
    waitTime,
    trustSignal,
    description,
    sports: normalizedSports
  };
}

function normalizeAndValidateContactMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    throw badRequest('Ugyldig kontaktmelding.');
  }

  const name = sanitizeString(payload.name, 2, 120, 'name');
  const email = sanitizeEmail(payload.email);
  const message = sanitizeString(payload.message, 5, 2000, 'message');

  return { name, email, message };
}

function normalizeSport(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase();

  if (!raw) {
    return '';
  }

  if (raw.startsWith('tennis')) return 'Tennis';
  if (raw.startsWith('squash')) return 'Squash';
  if (raw.startsWith('badminton')) return 'Badminton';
  return '';
}

function normalizeSportsList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map(normalizeSport).filter(Boolean))];
}

function toTitleCase(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function sanitizeString(value, minLength, maxLength, fieldName) {
  if (typeof value !== 'string') {
    throw badRequest(`${fieldName} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw badRequest(`${fieldName} must be between ${minLength} and ${maxLength} characters.`);
  }

  return trimmed;
}

function sanitizeOptionalString(value, minLength, maxLength) {
  if (value == null || value === '') {
    return '';
  }
  return sanitizeString(value, minLength, maxLength, 'value');
}

function sanitizeEmail(value) {
  const email = sanitizeString(value, 5, 120, 'email').toLowerCase();
  const basicEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!basicEmailRegex.test(email)) {
    throw badRequest('email must be a valid email address.');
  }
  return email;
}

function sanitizePhone(value) {
  const input = sanitizeString(value, 8, 20, 'phone');
  const digits = input.replace(/[^0-9]/g, '');
  let normalized = digits;

  if (normalized.startsWith('0047')) {
    normalized = normalized.slice(4);
  }
  if (normalized.startsWith('47') && normalized.length === 10) {
    normalized = normalized.slice(2);
  }

  if (!/^\d{8}$/.test(normalized)) {
    throw badRequest('phone must be a Norwegian mobile number (8 digits).');
  }

  return `47${normalized}`;
}

function parseBoolean(value, fieldName) {
  if (value === true || value === 'true' || value === 'yes' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 'no' || value === 0 || value === '0') {
    return false;
  }
  throw badRequest(`${fieldName} must be a boolean value.`);
}

function validateConfig() {
  requiredEnv('VIPPS_CLIENT_ID');
  requiredEnv('VIPPS_CLIENT_SECRET');
  requiredEnv('VIPPS_SUBSCRIPTION_KEY');
  requiredEnv('VIPPS_MSN');
}

function requiredEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function createReference() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `RS-${stamp}-${random}`;
}

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function safeReadResponse(response) {
  try {
    const text = await response.text();
    if (!text) {
      return 'No response body';
    }
    if (text.length > 500) {
      return `${text.slice(0, 500)}...`;
    }
    return text;
  } catch {
    return 'Unable to read response body';
  }
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
