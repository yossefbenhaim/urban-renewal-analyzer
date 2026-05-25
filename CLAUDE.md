# Urban Renewal Analyzer

כלי ציבורי בעברית: המשתמש מזין כתובת ברחוב בישראל ומקבל דוח היתכנות שמעריך את הסיכוי שהבניין יעבור פינוי-בינוי / תמ"א.

- Live: https://urban-renewal-analyzer.byclick.co.il
- Git: github.com/yossefbenhaim/urban-renewal-analyzer (branch: `main`)
- Local path: `~/urban-renewal-analyzer`

## Architecture

Monorepo (npm workspaces, `apps/*`):

- **`apps/api`** — Express 5 + TypeScript (port 3001, ESM, `tsx` for dev/prod).
  - Public endpoints: `GET /api/health`, `/api/cities`, `/api/streets`, `/api/validate-address`; `POST /api/evaluate`, `/api/lead`.
  - Flow ב-`POST /api/evaluate` (`src/routes/evaluate.ts`):
    1. Zod-validate the input.
    2. LRU cache lookup (`src/lib/cache.ts`, 24h TTL, key = `city|street|number|apartments|commercial|year`).
    3. **Foundation:** GovMap geocode + parcel — אם נכשל, מחזירים 404 (ללא קואורדינטות אי-אפשר להמשיך).
    4. **Tier-2 fan-out** עם `Promise.all` של 6 מקורות (renewal layer, MAVAT plans, data.gov.il urban renewal, MAVAT land-use, data.gov.il building sites, **`municipal_web` — Firecrawl + Claude extraction**).
    5. מצרפים את כל ה-`Signal[]`, מריצים `evaluateRubric` (דטרמיניסטי), מחילים `ageCap` לפי שנת בנייה.
    6. **Cross-validation:** `engine/validation.ts` שולח את כל ה-signals ל-Claude לקבל verdict `confirmed`/`contradicted`/`unverified` פר signal + `confidence` כללי (אינפורמטיבי בלבד, לא משנה את הציון).
    7. מחזירים JSON שלם.
  - Adapters ב-`src/sources/*` — כל אחד מחזיר `SourceFetchResult` עם `signals[]` ו-`partial`/`ok`. כל ה-HTTP הסטרוקטורי עובר דרך `src/lib/http.ts` (timeout 4s, retry יחיד עם jitter).
  - LLM/Firecrawl pipeline ב-`src/lib/`: `firecrawl.ts` (scrape → markdown), `anthropic.ts` (Sonnet 4.6, temp 0, prompt caching, raw fetch), `disk_cache.ts` (7-day JSON cache ב-`/data/llm-cache`, survives restarts).
  - המרת קואורדינטות ITM ↔ WGS84 ב-`src/lib/itm.ts` (proj4, EPSG:2039 רשמי).

- **`apps/web`** — Vite + React 18 + TS + Tailwind, RTL בעברית.
  - מסך אחד: `src/App.tsx` עם 3 features: `address/AddressPicker` (autocomplete + ולידציה חיה), `lead/LeadGate` (חוסם מסך לפני הדוח, שומר ב-localStorage), `report/MaturityGauge` (אנימציה 5 שניות לפני הצגת ציון).
  - הדפים מבוססים על **Silver Castle design tokens** (`sc-*` colors, Heebo font) — שיתוף ויזואלי בכוונה.
  - `vite.config.ts` עושה proxy ל-`/api` → `localhost:3001` בפיתוח. בפרודקשן nginx עושה proxy.

- **`packages/shared`** — לא קיים כאן (בניגוד ל-Silver Castle). הטיפוסים מוגדרים גם ב-`apps/api/src/types.ts` וגם ב-`apps/web/src/types.ts` ויש לשמור אותם **מסונכרנים ידנית**. ה-server הוא ה-source of truth.

## Deterministic scoring rubric

חשוב להבין לפני נגיעה ב-`engine/rubric.ts`:

- היה פעם סכום של `signal.weight` סביב baseline 50 → היה לא-יציב בין ריצות. הוחלף ב-**rubric קבוע**:
  1. 9 categories עם משקל אחוזי קבוע (סכום = 100). ראה `CATEGORY_WEIGHTS` ב-`engine/rubric.ts`.
  2. כל קטגוריה מייצרת subscore 0–100 מטבלת חיפוש קבועה.
  3. הציון הסופי = Σ (subscore × weight) / 100.
  4. החלק של כל מקור בדוח גם הוא **קבוע** — תלוי באילו קטגוריות הוא בעלים, לא במה שירה הפעם.
- **Hard cap לפי גיל הבניין** ב-`engine/recommend.ts:ageCap()`:
  - ≤5 שנים → max 15, וגם `track='unlikely'` אוטומטית.
  - ≤15 → max 30. ≤25 → max 55. מעל זה — אין cap.
- אותה כתובת + אותם קלטים = אותו ציון. אם משנים משקלים, מעדכנים גם את הסיכום בדוח ואת ה-cache key אם נוסף קלט חדש.

## Deploy

- Coolify app UUID: `f9oh8vy7zi4ga9h6ngckenkb`
- Deploy: `sudo ~/auto-deploy-urban-renewal-analyzer.sh` (pull → trigger Coolify deploy via `php artisan tinker`).
- Coolify בונה את `docker-compose.yml`:
  - `ura-api` — Node alpine, runs `npx tsx src/server.ts` (production לא מקמפלים — מריצים ישירות עם tsx).
  - `ura-web` — nginx alpine, מגיש את `apps/web/dist` ומעביר `/api/*` ל-`ura-api`.
- Traefik labels על `ura-web` בלבד (host = `urban-renewal-analyzer.byclick.co.il`, TLS via letsencrypt).
- **שתי רשתות:** `ura` (פנימית) + `coolify` (חיצונית, ל-Traefik). חובה `traefik.docker.network=coolify` (ראה memory: [[project_traefik_multinetwork]]).
- Volume `ura-data` ב-`/data` של ה-API שומר את `leads.jsonl` (append-only) — שורד restarts.

## Lead capture

- `POST /api/lead` (`src/routes/lead.ts`):
  1. Zod-validates name/phone/email/agreed.
  2. Appends JSON line ל-`/data/leads.jsonl`.
  3. **Mirror** ל-Asset Rise CRM ב-`https://admin.byclick.co.il/api/trpc/leads.create` — fire-and-forget, לא חוסם את התשובה ל-UI.
  4. גוף ה-tRPC הוא **payload גולמי**, לא `{ json: payload }` (זה היה bug ב-commit e35e30e).
- ה-UI חוסם את הצגת הדוח עד שהמשתמש מאשר את ה-LeadGate; ההסכמה נשמרת ב-localStorage כך ש-evaluation שנייה לא חוזרת על המסך.

## Local dev

```bash
npm install
npm run dev:api    # http://localhost:3001/api/health
npm run dev:web    # http://localhost:5173 (proxy /api → 3001)
```

אין `.env` חובה. אם רוצים לעקוף את ה-CRM mirror בפיתוח, אפשר `CRM_LEADS_URL=http://localhost:9999` או דומה. `LEADS_FILE` defaults ל-`/data/leads.jsonl` (לא יעבוד בפיתוח אלא אם תיצור את התיקייה — בפיתוח שגיאת כתיבה רק נרשמת ב-log, לא שוברת את הבקשה).

### LLM / Firecrawl env vars (כולם optional)

אם חסרים — `municipal_web` ו-`validation` מדלגים בשקט וה-evaluate חוזר בלעדיהם:

- `ANTHROPIC_API_KEY` — נדרש לחילוץ JSON ול-cross-check. שמור ב-`~/.openclaw/secrets.json` למקרים מקומיים.
- `FIRECRAWL_API_KEY` — נדרש ל-scrape של אתרי עיריות. צריך להוסיף ידנית ל-Coolify (Application → Environment Variables).
- `URA_LLM_MODEL` — default `claude-sonnet-4-6`.
- `LLM_CACHE_DIR` — default `/data/llm-cache` (בתוך הוולום `ura-data` שכבר קיים).

הקאש בדיסק TTL 7 ימים, מפתח SHA-256 של (system_prompt + user_prompt) — שינוי טקסט הפרומפט מבטל cached entries אוטומטית.

## Coding conventions

- TypeScript strict, ESM only, אין CommonJS.
- כל source adapter מחזיר `SourceFetchResult` עם `ok`/`partial`/`signals[]` — חוזה אחיד שמאפשר `Promise.allSettled` ב-orchestrator.
- אין mock לעולם. כל ה-adapters מדברים עם API ציבורי אמיתי (GovMap, MAVAT, data.gov.il). אם API נופל — הוא נופל; ה-rubric יודע להתמודד עם source נכשל (משקלו של ה-category נשאר אבל ה-subscore נכנס במצב placeholder).
- כל הטקסטים שמוצגים למשתמש — בעברית. שמות משתנים, קומיטים ולוגים — באנגלית.
- אחרי שינוי קוד: build + deploy + verify עם `curl -sI https://urban-renewal-analyzer.byclick.co.il` (ראה memory: [[feedback_deploy_after_changes]]).

## Common tasks

- **הוספת מקור נתונים חדש:** קובץ ב-`apps/api/src/sources/`, מחזיר `SourceFetchResult`. רושמים את שמו ב-`SourceName` ב-`types.ts` (גם ב-api וגם ב-web). מוסיפים `CATEGORY_SOURCE` mapping ב-`rubric.ts` והגדרת `CATEGORY_WEIGHTS`. מוסיפים קריאה ב-`evaluate.ts` ובמיפוי ה-source rows.
- **שינוי משקלי rubric:** רק ב-`CATEGORY_WEIGHTS` ב-`engine/rubric.ts`. ודא שהסכום עדיין 100. אחרת ה-source_contributions ישתבשו.
- **שינוי טווחי גילאי בניין:** סנכרן בין `engine/recommend.ts:ageCap()` לבין ה-rubric של `building_age` ב-`engine/rubric.ts` ובין הטקסט ב-`summaryHe()`.
- **בדיקת address validation מקומית:**
  ```bash
  curl 'http://localhost:3001/api/validate-address?city=חיפה&street=מצפה&number=30'
  ```

## Known constraints / gotchas

- GovMap `FreeSearch` הוא ה-foundation — אם הוא נופל, כל הדוח נופל. יש cache 24h ל-hit וגם ל-miss כדי לא להציף בקשות.
- `data.gov.il` מחזיר לפעמים HTML על שגיאה במקום JSON — `lib/http.ts` חושף את 200 התווים הראשונים בשגיאה כדי שאפשר יהיה לאבחן.
- ה-web app מחיל אנימציה של 5 שניות לפני שמראים את הציון (`MIN_LOADING_MS`). אם מקצרים את זה, ה-MaturityGauge ייראה קופץ.
- שני רשתות Docker חובה (`ura` + `coolify`) — בלי label `traefik.docker.network=coolify` Traefik יחזיר 504.
- בפרודקשן ה-API רץ עם `tsx` ישירות על ה-`src/*.ts`, **לא** מקובצים. שינוי TS = restart container (Coolify deploy יעשה את זה).
