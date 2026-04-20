// Desktop pulls the official Live2D Cubism framework sources in through the
// Vite-only `@framework/*` alias. Keep a source-level ambient module so any
// consumer that typechecks desktop renderer files can tolerate those imports.
declare module '@framework/*';
