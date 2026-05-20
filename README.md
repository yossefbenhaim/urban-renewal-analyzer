# Urban Renewal Analyzer

Public Hebrew tool that takes an Israeli street address and returns a feasibility
report estimating how likely the property is to undergo פינוי-בינוי / תמ"א.

Live at https://urban-renewal-analyzer.byclick.co.il/.

## Architecture

- `apps/api` — Node + Express service (port 3001). Calls GovMap, MAVAT and
  data.gov.il in parallel, runs a rule-based scoring engine, and returns a
  structured Hebrew report.
- `apps/web` — Vite + React landing page. Reuses the silver-castle `sc-*`
  design tokens for visual identity.

## Local dev

```
npm install
npm run dev:api    # http://localhost:3001/api/health
npm run dev:web    # http://localhost:5173
```

## Deploy

Coolify app deploys `docker-compose.yml`. Trigger via
`~/auto-deploy-urban-renewal-analyzer.sh`. Traefik routes
`urban-renewal-analyzer.byclick.co.il` to the `web` container.
