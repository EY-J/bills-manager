# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Responsive Test Tutorial

Use this before deploy to verify mobile/tablet/desktop layout fit.

1. Install Chromium for Playwright (one-time):
   `npm run test:responsive:install`
2. Run responsive smoke test:
   `npm run test:responsive`
3. Faster rerun (skip build):
   Windows PowerShell: `$env:SKIP_BUILD='1'; npm run test:responsive`
   macOS/Linux: `SKIP_BUILD=1 npm run test:responsive`

The script checks:
- no horizontal overflow
- settings modal width fit
- bill details modal width fit
- bill editor modal width fit
