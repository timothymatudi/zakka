import coreWebVitals from 'eslint-config-next/core-web-vitals';
import tsConfig from 'eslint-config-next/typescript';

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...tsConfig,
];

export default config;
