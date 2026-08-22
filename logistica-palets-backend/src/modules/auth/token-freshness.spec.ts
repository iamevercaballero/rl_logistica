import { wasIssuedBeforePasswordChange } from './token-freshness';

describe('wasIssuedBeforePasswordChange', () => {
  it('token emitido antes del cambio de contraseña: inválido', () => {
    const iat = Math.floor(new Date('2026-08-21T10:00:00Z').getTime() / 1000);
    const passwordChangedAt = new Date('2026-08-21T10:05:00Z');
    expect(wasIssuedBeforePasswordChange(iat, passwordChangedAt)).toBe(true);
  });

  it('token emitido después del cambio de contraseña: sigue válido', () => {
    const iat = Math.floor(new Date('2026-08-21T10:10:00Z').getTime() / 1000);
    const passwordChangedAt = new Date('2026-08-21T10:05:00Z');
    expect(wasIssuedBeforePasswordChange(iat, passwordChangedAt)).toBe(false);
  });

  it('mismo segundo: se considera válido (no antes)', () => {
    const changedAt = new Date('2026-08-21T10:05:00.000Z');
    const iat = Math.floor(changedAt.getTime() / 1000);
    expect(wasIssuedBeforePasswordChange(iat, changedAt)).toBe(false);
  });

  it('usuario que nunca cambió la contraseña (passwordChangedAt = alta): tokens posteriores siguen válidos', () => {
    const createdAt = new Date('2020-01-01T00:00:00Z');
    const iatAhora = Math.floor(Date.now() / 1000);
    expect(wasIssuedBeforePasswordChange(iatAhora, createdAt)).toBe(false);
  });
});
