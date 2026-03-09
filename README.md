# Stringer Booking Website

Simple booking site for tennis racket restringing.

## Features

- Booking form with:
  - tension selection (16-32 kg)
  - option for own string (`yes/no`)
  - contact and racket details
- Price calculation:
  - labor: `NOK 175`
  - string material: `NOK 125` (only when customer does not bring own string)
- Payment modes:
  - `manual` (default): customer sees "Vipps til 97908575"
  - `vipps`: Vipps ePayment integration with redirect + status verification
- Local booking storage in `data/bookings.json`

## Setup

1. Copy environment template:

```bash
cp .env.example .env
```

2. By default, keep manual mode:

- `PAYMENT_MODE=manual`
- `MANUAL_VIPPS_NUMBER=97908575`

3. If you want Vipps ePayment integration, set:

- `PAYMENT_MODE=vipps`
- `VIPPS_CLIENT_ID`
- `VIPPS_CLIENT_SECRET`
- `VIPPS_SUBSCRIPTION_KEY`
- `VIPPS_MSN`
- `APP_BASE_URL` (must be your public domain for real callbacks)

4. Start server:

```bash
npm start
```

5. Open:

- `http://localhost:3000`

## API Endpoints

- `POST /api/bookings`
  - Creates booking
  - Returns booking reference and amount
- `GET /api/bookings/complete?reference=...`
  - Returns booking/payment status
- `GET /api/bookings/status?reference=...`
  - Reads local booking status

## Notes

- This project uses Node's built-in `fetch` (Node 18+).
- Keep Vipps secrets only in server-side `.env` when `PAYMENT_MODE=vipps`.
- For production Vipps mode, run behind HTTPS and set `APP_BASE_URL` to that HTTPS URL.
