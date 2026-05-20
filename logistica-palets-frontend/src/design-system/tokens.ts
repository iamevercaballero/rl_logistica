/**
 * Design tokens tipados para uso desde componentes React/TS.
 * Los valores runtime viven como CSS variables en index.css (`[data-theme="..."]`).
 * Este archivo es la referencia documental + helpers para JS (charts, inline styles).
 */

export const themes = ['dark', 'light'] as const;
export type Theme = (typeof themes)[number];

export const tokenNames = [
  'bg',
  'bg-base',
  'panel',
  'panel-mid',
  'panel-hi',
  'panel-top',
  'text',
  'text-variant',
  'muted',
  'border',
  'border-dim',
  'primary',
  'primary-hover',
  'primary-text',
  'primary-light',
  'ring',
  'success',
  'warning',
  'danger',
  'info',
] as const;
export type TokenName = (typeof tokenNames)[number];

/** Devuelve `var(--<token>)` para usar en estilos inline. */
export const tk = (name: TokenName): string => `var(--${name})`;

/** Espaciado base 4px (Tailwind-like). */
export const space = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
} as const;

/** Escala tipográfica. */
export const fontSize = {
  xs: '11px',
  sm: '12px',
  base: '13px',
  md: '14px',
  lg: '16px',
  xl: '20px',
  '2xl': '26px',
} as const;

export const radius = {
  xs: '2px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  full: '999px',
} as const;

/** Lee un token CSS desde el DOM (útil para Recharts u otras libs JS). */
export function readToken(name: TokenName): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement)
    .getPropertyValue(`--${name}`)
    .trim();
}
