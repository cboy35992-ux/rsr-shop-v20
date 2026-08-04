# RSR Shop Marketplace V23

A responsive, installable marketplace-style Robux shop for customer orders and admin fulfillment.

## Customer app

- Shop: Covered Tax, Not Covered Tax, Instant Send, and Gifting
- My Orders with transaction IDs and delivery proof
- Live Chat and gifting-order communication
- Browser/app notifications while the app is active
- Profile, Vouches, Tutorials, and Dark/Light mode
- Facebook and email fallback support
- Installable PWA for Android, iPhone/iPad, Windows, macOS, and Chromebook

## Admin app

- Sales Dashboard
- Manage Orders with submitted CT/NCT gamepasses and direct Open/Buy links
- Live Support
- Analytics
- Rate and method settings
- Tutorial video management
- Delivery proof upload
- Browser/app notifications for order/chat activity while active
- Contact and announcement management

## Render

- Root Directory: blank
- Build Command: `npm install`
- Start Command: `npm start`

Required environment variables:

- `JWT_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

The Facebook page and support email can be edited in Admin → Rates & Settings. Default contact details:

- Facebook: https://www.facebook.com/profile.php?id=61592793360824
- Email: reckshopemergencycontact@gmail.com

## Important

Browser notifications work while the website or installed PWA is active. Notifications while the app is fully closed require a dedicated push service and push subscription backend.

Render Free uses temporary local storage. For permanent production accounts, orders, chats, receipts, and proofs, use a permanent database and cloud file storage.
