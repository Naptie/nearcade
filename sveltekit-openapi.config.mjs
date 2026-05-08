/** @type {import('@sveltekit-openapi/core').SvelteKitOpenAPIConfig} */
const config = {
  routesDir: 'src/routes',
  output: 'static/openapi.json',
  format: 'json',
  schemaFiles: ['src/lib/schemas/**/*.ts'],
  info: {
    title: 'nearcade API',
    version: '0.1.0',
    description: 'OpenAPI documentation for the nearcade API.'
  },
  servers: [{ url: '/', description: 'Current deployment' }],
  viewer: 'swagger'
};

export default config;
