# RSR SHOP V20

Clean, dependency-free Render deployment for a Robux shop.

## Features
- Customer registration and login with 180-day saved sessions
- Admin login from Render environment variables
- Covered Tax, Not Covered Tax, Instant Send, and Gifting
- Roblox profile, gamepass, and game verification
- Automatic Robux, Covered Tax gamepass, and peso calculations
- GCash and GoTyme QR payment proof upload
- Admin receipt verification, Processing, Complete, and Decline actions
- Customer/admin near-live chat (2-second refresh)
- Legit and approved vouch area
- Responsive phone/tablet/desktop layout
- Installable PWA
- Zero external npm dependencies

## GitHub
Create a new repository named `rsr-shop-v20`. Upload the files in this folder directly to the repository root. Do not upload old versions or ZIP files into the repository.

## Render
- Language: Node
- Root Directory: leave blank
- Build Command: `node --check server.js`
- Start Command: `npm start`

## Required environment variables
- `NODE_ENV=production`
- `JWT_SECRET=<generate once and never change>`
- `ADMIN_EMAIL=<your admin email>`
- `ADMIN_PASSWORD=<your private admin password>`

Optional:
- `SHOP_NAME=RSR SHOP`
- `CONTACT_EMAIL=...`
- `CONTACT_PHONE=...`
- `BUSINESS_LOCATION=Philippines`
- `FACEBOOK_URL=...`

## Persistent data
Attach a Render persistent disk at `/var/data`, then set:
`DATA_DIR=/var/data`

Without a persistent disk, Render can erase accounts, orders, chats, and receipts during some deployments.
