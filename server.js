#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const PAYMENT_MODE = (process.env.PAYMENT_MODE || 'manual').toLowerCase();
const MANUAL_VIPPS_NUMBER = process.env.MANUAL_VIPPS_NUMBER || '97908575';
const VIPPS_ENV = (process.env.VIPPS_ENV || 'test').toLowerCase();
const VIPPS_AUTO_CAPTURE = (process.env.VIPPS_AUTO_CAPTURE || 'true').toLowerCase() === 'true';

const TOKEN_ENDPOINT =
  VIPPS_ENV === 'production'
    ? 'https://api.vipps.no/accesstoken/get'
    : 'https://apitest.vipps.no/accesstoken/get';
const EPAYMENT_BASE_URL =
  VIPPS_ENV === 'production' ? 'https://api.vipps.no/epayment/v1' : 'https://apitest.vipps.no/epayment/v1';

const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

ensureDataFile();

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && parsedUrl.pathname === '/api/bookings') {
      const payload = await parseJsonBody(req);
      const booking = await createBookingAndPayment(payload);
      return sendJson(res, 201, booking);
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/api/bookings/complete') {
      const reference = parsedUrl.searchParams.get('reference');
      if (!reference) {
        return sendJson(res, 400, { error: 'Missing reference query parameter.' });
      }

      const result = await completeBooking(reference);
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/api/bookings/status') {
      const reference = parsedUrl.searchParams.get('reference');
      if (!reference) {
        return sendJson(res, 400, { error: 'Missing reference query parameter.' });
      }

      const booking = findBooking(reference);
      if (!booking) {
        return sendJson(res, 404, { error: 'Booking not found.' });
      }

      return sendJson(res, 200, booking);
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, env: VIPPS_ENV, paymentMode: PAYMENT_MODE });
    }

    serveStaticFile(req, res, parsedUrl.pathname);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendJson(res, statusCode, { error: error.message || 'Unexpected server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on ${APP_BASE_URL}`);
});

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
      'client_id': requiredEnv('VIPPS_CLIENT_ID'),
      'client_secret': requiredEnv('VIPPS_CLIENT_SECRET'),
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
      'Authorization': `Bearer ${accessToken}`,
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
      'Authorization': `Bearer ${accessToken}`,
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
      'Authorization': `Bearer ${accessToken}`,
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

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(BOOKINGS_FILE)) {
    fs.writeFileSync(BOOKINGS_FILE, '[]\n', 'utf8');
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

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(badRequest('Request body too large.'));
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch {
        reject(badRequest('Request body must be valid JSON.'));
      }
    });

    req.on('error', (error) => reject(error));
  });
}

function serveStaticFile(req, res, pathname) {
  let requestedPath = pathname;
  if (requestedPath === '/') {
    requestedPath = '/index.html';
  }

  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  const isWithinPublicDir =
    filePath === PUBLIC_DIR || filePath.startsWith(PUBLIC_DIR + path.sep);

  if (!isWithinPublicDir) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return sendText(res, 404, 'Not found');
    }

    const contentType = getContentType(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
}

function getContentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
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
