/// <reference types="vite/client" />

declare module 'virtual:gd-model-index' {
  const index: import('../../ai/src/policy/resolve').PolicyIndex;
  export default index;
  export const productCatalog: unknown;
  export const releaseCatalog: unknown;
}
