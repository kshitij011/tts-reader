# Stillvoice

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {

  A private, browser-only text-to-speech reader for documents and AI responses. Text is processed and spoken locally with the Web Speech API; there is no backend or external speech service.

  ## Development

  ```sh
  npm install
  npm run dev
  ```

  ## Checks

  ```sh
  npm run build
  npm run lint
  ```

  ## Vercel

  Import the repository in Vercel. It builds with `npm run build` and serves static output from `dist/`, as configured in `vercel.json`.

  Voice availability depends on the browser and operating system. Speech synthesis is most reliable on `localhost` or an HTTPS deployment.
