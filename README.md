# SakhiBiz — Idea-to-Income Journey

SakhiBiz is a Marathi-first business learning and management platform for rural women in Maharashtra. It provides a React + Vite frontend, an Express API, MySQL persistence, product image storage, and browser drafts for guest use.

## Features

- Marathi and English interface, registration, login and guest exploration
- Dashboard with direct access to business tools
- Sakhi Saathi business coach and a bilingual learning centre with lessons, video discovery and quizzes
- Business plan builder, cost and profit calculator, product catalogue and promotional content generator
- Product editing, image upload and removal
- Business readiness tasks saved to the account for signed-in users and to browser storage for guests
- Sakhi Circle groups, memberships, moderated posts, reports and discovery
- Optional voice dictation and read-aloud, subject to browser and device support

## Requirements

- Node.js 20 or later and npm
- MySQL 8 (or compatible MySQL server)

## First-time setup

1. Start MySQL Server.
2. In MySQL Workbench, run `database/schema.sql`, then `database/seed.sql`.
3. Copy `.env.example` to `.env`. Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` to the account/database you created. Replace `JWT_SECRET` with a long private random value. Keep `.env` private.
4. Install project dependencies with `npm install`.

The optional `database/authentication.sql` explains how to create a least-privilege SQL account. Replace its placeholders with your own password before running those example statements, or use a database account already configured for the project.

## Run locally on Windows

Open two PowerShell terminals in the project folder.

Terminal 1 — frontend:

```powershell
npm run dev
```

Terminal 2 — API:

```powershell
npm run dev:api
```

Open the Vite address shown in the first terminal, normally `http://localhost:5173`. Vite forwards `/api` and `/uploads` to the API at port 3001. Use **Explore as guest** to explore local-only features without MySQL; account registration, community, and cross-device persistence require a running database and correct `.env` values. The API health endpoint is `http://localhost:3001/api/health` and reports database connectivity.

## Database and data storage

The browser communicates with Express; it never connects directly to MySQL. Private API routes use a signed HttpOnly session cookie and check record ownership. MySQL stores accounts, lessons, progress, quiz results, business plans, products, expenses, promotions, readiness tasks and community data. Product image bytes are stored in `uploads/products` (or `UPLOAD_DIR`); MySQL stores the image URL. Guest drafts and preferences remain in the browser on that device.

To use a non-root MySQL account, grant only the permissions described in `database/authentication.sql` for the `sakhibiz` database. Use the same credentials in `.env`.

## Production build and deployment

Build and run the app from one origin:

```powershell
npm run build
npm start
```

Configure `NODE_ENV=production`, `CLIENT_ORIGIN=https://your-site.example`, a private `JWT_SECRET`, database connection variables, and optionally `API_PORT`, `HOST`, and `UPLOAD_DIR` in the deployment environment. Express serves `dist` and the `/api` endpoints from the same origin; use HTTPS so secure login cookies work. Configure persistent storage and backups for MySQL and `UPLOAD_DIR`. Deploying on ephemeral filesystems without persistent uploads will lose product photos after a restart. Never publish `.env` or credentials.

### Public internet deployment with Docker

The repository includes a Docker Compose setup with MySQL, persistent MySQL and photo volumes, and Caddy as an HTTPS reverse proxy. It is intended for a Linux VPS with Docker Engine and Docker Compose installed. A domain is needed for automatic HTTPS. Point the domain's DNS `A` record to the server's public IP and allow inbound ports 80 and 443 in its firewall.

1. Copy `.env.docker.example` to `.env.docker` on the server. Set `DOMAIN` and generate unique private passwords/secrets for `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and `JWT_SECRET`.
2. From the project folder on the server, run `docker compose --env-file .env.docker up -d --build`.
3. Check startup with `docker compose --env-file .env.docker ps` and logs with `docker compose --env-file .env.docker logs -f app`.
4. Visit `https://your-domain.example`. Check `https://your-domain.example/api/health` reports `database: connected`.

MySQL schema and lesson seed files run automatically only on the first startup with an empty database volume. The database and product photos persist in Docker volumes across container restarts. Back up those volumes before upgrades or maintenance; replacing the database volume deletes user data. Keep `.env.docker` private and outside source control. The VPS and domain are separate services that must be obtained and paid for as required by their providers.

## API overview

- Authentication and profile: `/api/auth/*`, `/api/profile`
- Learning and progress: `/api/lessons`, `/api/progress`, `/api/quizzes/submit`
- Plans and products: `/api/business-plans`, `/api/products`
- Expenses, promotions and tasks: `/api/expenses`, `/api/promotions/generate`, `/api/action-tasks`
- Dashboard and coach: `/api/dashboard`, `/api/coach/recommend`
- Sakhi Circle: `/api/community/*`
- Health: `GET /api/health`

## Notes

- Sakhi Saathi uses deterministic suggestions, not generative AI or professional business advice.
- Video lessons link to relevant YouTube searches and need an internet connection.
- Marathi voice availability depends on browser/device support; browser-model transcription may download its model on first use.
- Pricing results are estimates and do not replace accounting or tax advice.
- Community posts enter moderator review. A public launch still needs an operating moderation policy and ongoing moderator coverage.
- Offline mode caches the app shell and stores selected guest drafts; it does not sync offline changes into MySQL.
