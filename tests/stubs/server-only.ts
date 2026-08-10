/**
 * Stub for Next's `server-only` marker package.
 *
 * `server-only` exists to make the *build* fail if a server module is pulled
 * into a client bundle; it has no runtime behaviour and is not resolvable
 * outside Next's compilation. Vitest therefore cannot load any module that
 * imports it, which would exclude exactly the server-side code most worth
 * unit-testing. Aliasing it to this empty module in vitest.config.ts restores
 * that, and leaves the real guarantee — which is enforced by `next build` —
 * completely untouched.
 */
export {};
