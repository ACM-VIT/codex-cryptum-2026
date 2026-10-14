# Codex Cryptum

CTF participant frontend built with React, TypeScript, Vite, Tailwind CSS, and GSAP. Application source, dependencies, configuration, and tests live in `frontend/`.

## Run

Requires Node.js 22.12+.

```sh
cd frontend
npm ci
npm run dev
```

## Check and build

Run from `frontend/`:

```sh
npm test
npm run build
npm run preview
```

The production output is `frontend/dist/`. For hosting, set the project root to `frontend`, the build command to `npm run build`, and the output directory to `dist`.

## Integration

The default is a browser-local frontend preview with scripted responses and sample standings. Google authentication, shared teams across devices, model hosting, and guardrails are not connected.

For the existing API adapter, copy `frontend/.env.example` to `frontend/.env.local` and set `VITE_API_BASE_URL`. Endpoints are defined in `frontend/src/lib/api.ts`; request/response types are in `frontend/src/lib/contracts.ts`. Individual authentication and team creation/joining still need backend integration. Do not put secrets in `VITE_*` variables.

Component credits are retained in [frontend/THIRD_PARTY.md](frontend/THIRD_PARTY.md); font licenses are in `frontend/public/licenses/`.

## GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` tests, builds, and publishes `frontend/dist` after frontend changes are pushed to `main`. In repository **Settings → Pages**, select **GitHub Actions** as the source. The deployment URL is https://minnhaaaaa.github.io/Codex-Cryptum-2026/. Hash routing supports direct challenge and leaderboard links. This publishes the browser-local frontend preview.
