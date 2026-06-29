// vite.config.js
// Usa import() dinâmico para evitar o deprecated CJS Node API do Vite 6
module.exports = async () => {
  const { defineConfig } = await import('vite');
  const { default: react } = await import('@vitejs/plugin-react');

  return defineConfig({
    plugins: [react()],
    base: './',
    server: {
      port: 5173,
      strictPort: true
    }
  });
};
