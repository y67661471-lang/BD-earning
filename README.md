# AI Secure Earn

A modern earning and reward platform built as a secure prototype for the BD Earning concept.

## Overview

This project includes:
- A responsive landing page with user dashboard sections
- Admin panel for user, campaign, payout, and risk management
- Security-first layout and workflow design for ad rewards and referrals
- Telegram-style login experience and protected admin access concept

## Included pages
- `/` — public landing page
- `/app` — same user-facing earning dashboard entry
- `/admin` — secure admin dashboard

## Local development

```bash
cd backend
npm install
node server.js
```

Then open:
- http://localhost:3000/
- http://localhost:3000/admin

## Notes

This is a prototype designed for UI/demo and architectural concept validation. For production, it should be expanded with:
- real Telegram auth verification
- database-backed reward ledger and wallets
- secure API validation and webhook signatures
- admin authorization and audit logging
- bKash payout integration and manual approval workflow

