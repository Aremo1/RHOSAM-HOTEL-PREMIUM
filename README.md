# 🏨 RHoSAM Hotel & Suites — Premium Management Platform

A full-stack hotel management system built with React, Express.js, and PostgreSQL. Features a guest mobile app with digital key, room controls, room service, spa booking, and local experiences concierge.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-20-green.svg)
![React](https://img.shields.io/badge/react-18-blue.svg)
![PostgreSQL](https://img.shields.io/badge/postgresql-16-blue.svg)

## 🌟 Features

### Guest Mobile App
- 🔑 **Digital Key** — QR code/NFC room unlock with access logging
- 🎮 **Room Controls** — Lights, AC, TV, curtains, Do Not Disturb
- 🍽️ **Room Service** — Browse menu, order food, track delivery
- 💆 **Spa Booking** — Book appointments, view schedule, cancel
- 📍 **Local Experiences** — Book tours, boat cruises, cultural activities
- 📋 **Folio/Bill** — View charges, make payments online
- 💳 **Payments** — Paystack/Flutterwave integration
- 🔔 **Notifications** — Real-time via WebSocket

### Staff Admin Panel
- 📊 **Dashboard** — Revenue, occupancy, alerts overview
- 🛏️ **Reservations** — Check-in/out, room assignment, VIP flags
- 👥 **Guest Management** — Profiles, preferences, loyalty tiers
- 🏠 **Room Management** — Status tracking, maintenance requests
- 👨‍🍳 **Restaurant/F&B** — Menu management, order processing
- 💆 **Spa Management** — Appointment scheduling, therapist assignment
- 📍 **Experiences** — Booking confirmation, guest coordination
- 🧹 **Housekeeping** — Task assignment, priority management
- 📅 **Employee Scheduling** — Shifts, swaps, pay rates
- 💰 **Finance** — Expenses, invoices, revenue reports
- 🔒 **Security** — Incident reporting, access logs

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- npm or yarn

### 1. Clone the repository
```bash
git clone https://github.com/Aremo1/RHOSAM-HOTEL-PREMIUM.git
cd RHOSAM-HOTEL-PREMIUM
```

### 2. Set up the database
```bash
# Create database
psql -U postgres -c "CREATE DATABASE rhosam_hotel;"
```

### 3. Configure environment
```bash
cd backend
cp .env.example .env
# Edit .env with your database credentials
```

### 4. Install dependencies
```bash
# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 5. Start the application
```bash
# Terminal 1 - Backend (port 5000)
cd backend && npm run dev

# Terminal 2 - Frontend (port 5173)
cd frontend && npm run dev
```

### 6. Open in browser
- **Staff Admin:** http://localhost:5173
- **Guest App:** http://localhost:5173/guest

## 🔐 Default Credentials

### Staff Login
| Role | Email | Password |
|------|-------|----------|
| Admin | admin@rhosamhotel.com | admin123 |
| Manager | manager@rhosamhotel.com | staff123 |
| Front Desk | frontdesk@rhosamhotel.com | staff123 |
| Restaurant | chidi@rhosamhotel.com | staff123 |

### Guest Login
Use any confirmation number from the database with the guest's last name.

## 📁 Project Structure

```
RHOSAM-HOTEL-PREMIUM/
├── backend/
│   ├── src/
│   │   ├── server.js          # Express API (all routes)
│   │   └── migrations/        # Database migrations
│   ├── .env                   # Environment variables
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Staff admin panel
│   │   ├── GuestMobileApp.jsx # Guest mobile app
│   │   ├── PaymentModal.jsx   # Payment integration
│   │   └── ...
│   ├── vite.config.js
│   └── package.json
├── .github/workflows/
│   ├── ci.yml                 # CI pipeline
│   └── deploy.yml             # CD pipeline
└── README.md
```

## 🗄️ Database Schema

### Core Tables
| Table | Description |
|-------|-------------|
| `guests` | Guest profiles and preferences |
| `reservations` | Booking records with status tracking |
| `rooms` | Room inventory with status |
| `room_types` | Room categories with pricing |
| `folios` | Guest billing accounts |
| `folio_items` | Individual charges and payments |

### Service Tables
| Table | Description |
|-------|-------------|
| `digital_keys` | QR/NFC room keys |
| `room_controls` | Smart room settings |
| `spa_appointments` | Spa bookings |
| `spa_services` | Spa menu |
| `restaurant_menu` | Food & beverage menu |
| `restaurant_orders` | Room service orders |
| `local_experiences` | Tours and activities |
| `experience_bookings` | Experience reservations |

### Operations Tables
| Table | Description |
|-------|-------------|
| `users` | Staff accounts with roles |
| `housekeeping_tasks` | Cleaning/maintenance tasks |
| `employee_shifts` | Work schedules |
| `shift_swaps` | Shift exchange requests |
| `events` | Weddings, conferences |
| `expenses` | Financial tracking |
| `notifications` | Push notification log |
| `audit_logs` | System audit trail |

## 🔌 API Endpoints

### Guest API (`/api/guest/`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/login` | Guest login with confirmation number |
| GET | `/stay` | Get stay details |
| POST | `/check-in` | Check in to room |
| POST | `/check-out` | Check out from room |
| GET | `/digital-key` | Get digital key |
| POST | `/digital-key/activate` | Activate key |
| POST | `/digital-key/unlock` | Unlock room |
| GET | `/room-controls` | Get room settings |
| PATCH | `/room-controls` | Update room settings |
| GET | `/room-service` | Browse menu |
| POST | `/room-service` | Place order |
| GET | `/spa/services` | Browse spa services |
| POST | `/spa/book` | Book appointment |
| DELETE | `/spa/:id` | Cancel appointment |
| GET | `/spa/my-appointments` | View bookings |
| GET | `/experiences` | Browse experiences |
| POST | `/concierge` | Submit request |
| GET | `/concierge` | View requests |
| GET | `/folio` | View bill |
| POST | `/payments/initialize` | Start payment |
| POST | `/payments/verify` | Verify payment |
| GET | `/payments` | Payment history |
| GET | `/notifications` | View notifications |

### Staff API
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Staff login |
| GET | `/reservations` | List reservations |
| PATCH | `/reservations/:id/status` | Check-in/out |
| GET | `/rooms` | List rooms |
| PATCH | `/rooms/:id` | Update room |
| GET | `/guests` | List guests |
| POST | `/restaurant/orders` | Create order |
| PATCH | `/restaurant/orders/:id` | Update order status |
| GET | `/housekeeping` | List tasks |
| POST | `/housekeeping` | Create task |
| GET | `/folios/:id` | View folio |
| POST | `/folios/:id/payment` | Record payment |
| GET | `/finance/dashboard` | Revenue summary |
| POST | `/expenses` | Record expense |
| GET | `/employees/schedule` | View schedule |
| POST | `/employees/shifts` | Create shift |
| POST | `/shift-swaps/:id/approve` | Approve swap |

## 💳 Payment Integration

### Supported Gateways
- **Paystack** — Card, Bank Transfer, USSD
- **Flutterwave** — Card, Bank, Mobile Money
- **Internal** — Cash/Manual payments

### Configuration
```env
# In backend/.env
PAYMENT_GATEWAY=PAYSTACK
PAYSTACK_SECRET_KEY=sk_test_xxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
PAYMENT_WEBHOOK_SECRET=your_webhook_secret
```

### Webhook Endpoints
- Paystack: `POST /api/webhooks/paystack`
- Flutterwave: `POST /api/webhooks/flutterwave`

## 🚢 Deployment

### Environment Variables
```env
PORT=5000
DATABASE_URL=postgresql://user:pass@host:5432/rhosam_hotel
JWT_SECRET=your-production-secret
PAYMENT_GATEWAY=PAYSTACK
PAYSTACK_SECRET_KEY=sk_live_xxxxx
PAYSTACK_PUBLIC_KEY=pk_live_xxxxx
```

### Recommended Platforms
- **Backend:** Render, Railway, DigitalOcean
- **Frontend:** Vercel, Netlify
- **Database:** Neon, Supabase, Railway

### GitHub Actions
CI/CD is configured in `.github/workflows/`:
- **CI:** Runs tests on every push/PR
- **CD:** Deploys after CI passes

## 🧪 Testing

```bash
# Backend tests
cd backend && npm test

# Frontend build
cd frontend && npm run build
```

## 📝 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing`)
5. Open a Pull Request

## 📞 Support

For support, email rhosam.rhosam@gmail.com or create an issue on GitHub.

---

**Built with ❤️ by [Aremo1](https://github.com/Aremo1) using Codebuff 🤖**
