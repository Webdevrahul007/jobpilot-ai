# JobPilot AI — Deployment Guide

## Option A: VPS / Self-hosted (Recommended)

The easiest production setup — one server running all 5 containers via Docker Compose.

### Prerequisites

- Ubuntu 22.04 VPS (4GB RAM minimum — Playwright needs it)
- Docker + Docker Compose installed
- Domain name (optional but recommended for SSL)

### Steps

**1. Clone the repo on your server**
```bash
git clone https://github.com/YOUR_USERNAME/jobpilot-ai.git
cd jobpilot-ai
```

**2. Place your resume**
```bash
# Copy your PDF to the server
scp Rahul_Jangid_Resume.pdf user@your-server:/home/user/jobpilot-ai/resumes/
```

**3. Create production environment file**
```bash
cp .env.example .env.prod
nano .env.prod
```

Fill in all `<CHANGE_ME>` values. Generate JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**4. Build Docker images**
```bash
# Build all three images
docker build -f docker/api.Dockerfile -t jobpilot-api:latest .
docker build -f docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://your-domain.com/api/v1 \
  --build-arg NEXT_PUBLIC_DEV_USER_ID=your-user-id \
  -t jobpilot-web:latest .
docker build -f docker/worker.Dockerfile -t jobpilot-worker:latest .
```

**5. Start all services**
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
```

**6. Verify all services are healthy**
```bash
docker compose -f docker-compose.prod.yml ps
curl http://localhost:4000/api/v1/health/ready
```

**7. Run database seed (first deploy only)**
```bash
docker exec jobpilot_api_prod node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
async function seed() {
  const hash = await bcrypt.hash('YourPassword123!', 12);
  await prisma.user.upsert({
    where: { email: 'your@email.com' },
    update: {},
    create: {
      email: 'your@email.com',
      password: hash,
      name: 'Your Name',
      profile: { create: {
        firstName: 'Your', lastName: 'Name',
        phone: '+91-9999999999', city: 'Bangalore', country: 'India',
        totalYearsExp: 3, noticePeriodDays: 30,
        resumeFileName: 'Rahul_Jangid_Resume.pdf'
      }}
    }
  });
  console.log('Seeded');
}
seed().finally(() => prisma.\$disconnect());
"
```

**8. (Optional) Setup Nginx reverse proxy**
```nginx
server {
    server_name your-domain.com;

    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 180s;  # Important: browser runs take time
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then add SSL with Certbot:
```bash
certbot --nginx -d your-domain.com
```

---

## Option B: Railway (PaaS)

Railway works best for the API and Web services. The Worker needs Playwright
(Chromium) which requires a large image — use the VPS option for the worker
and Railway for API + Web only.

### Services to create in Railway

| Service | Dockerfile | Port |
|---------|-----------|------|
| api     | `docker/api.Dockerfile` | 4000 |
| web     | `docker/web.Dockerfile` | 3000 |
| postgres | Railway Plugin | — |
| redis   | Railway Plugin | — |

**Worker is NOT deployed to Railway** (Playwright image is ~1.5GB, exceeds Railway's limits).
Run the worker on a separate VPS or Render instance.

### Railway environment variables (API service)

```
NODE_ENV=production
PORT=4000
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=redis://:${{Redis.REDIS_PASSWORD}}@${{Redis.RAILWAY_TCP_PROXY_HOST}}:${{Redis.RAILWAY_TCP_PROXY_PORT}}
JWT_SECRET=<generate-with-crypto>
CORS_ORIGIN=https://your-web-service.up.railway.app
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_SESSION_DIR=/app/.sessions
RESUME_FILE_PATH=/app/resumes/Rahul_Jangid_Resume.pdf
LOG_DIR=/app/logs
```

### Railway environment variables (Web service)

```
NEXT_PUBLIC_API_URL=https://your-api-service.up.railway.app/api/v1
NEXT_PUBLIC_DEV_USER_ID=<your-user-id-from-db>
```

### Railway build config (set in dashboard)

- **API**: Dockerfile path = `docker/api.Dockerfile`, Root = `/`
- **Web**: Dockerfile path = `docker/web.Dockerfile`, Root = `/`

---

## Updates / Redeployment

### VPS
```bash
git pull
docker build -f docker/api.Dockerfile -t jobpilot-api:latest .
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps api worker
```

### Railway
Push to `main` branch — Railway auto-deploys.

---

## Monitoring

### Check logs
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker

# Log files on disk
tail -f logs/jobpilot-api-$(date +%Y-%m-%d).log
tail -f logs/jobpilot-api-error-$(date +%Y-%m-%d).log
```

### Health checks
```bash
# Liveness (process alive)
curl https://your-domain.com/api/v1/health/live

# Readiness (DB + Redis + resume)
curl https://your-domain.com/api/v1/health/ready

# Queue stats
curl "https://your-domain.com/api/v1/queue/stats"
```

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Worker not processing jobs | Session expired | Login via `/api/v1/linkedin/login` |
| 401 on all queue endpoints | No LinkedIn session | Login first |
| CAPTCHA on login | LinkedIn bot detection | Use headed browser, solve manually |
| Resume upload fails | Wrong path | Check `RESUME_FILE_PATH` in `/health/ready` |
| Worker OOM crash | Not enough RAM | Upgrade to 4GB VPS |

---

## Security checklist before going live

- [ ] `JWT_SECRET` is at least 48 chars and randomly generated
- [ ] `POSTGRES_PASSWORD` is strong and not the dev default
- [ ] `REDIS_PASSWORD` is set (Redis without password is open to the internet)
- [ ] `.env.prod` is NOT committed to git
- [ ] `CORS_ORIGIN` is set to your exact domain (not `*`)
- [ ] LinkedIn credentials are a secondary account (bot detection risk)
- [ ] Nginx SSL is configured if self-hosting
- [ ] Firewall blocks port 5432 and 6379 from external access
