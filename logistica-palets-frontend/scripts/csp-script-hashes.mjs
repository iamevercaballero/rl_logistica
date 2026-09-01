/**
 * Calcula los hashes SHA-256 de los <script> inline de `dist/index.html`.
 *
 * `index.html` trae un script inline deliberado: aplica el tema antes del
 * primer paint para evitar el flash. Con `script-src 'self'` el navegador lo
 * bloquea y la app arranca sin tema.
 *
 * La salida son directivas `'sha256-...'` para la CSP. Se calculan acá y no a
 * mano porque el hash cambia con cualquier retoque del script —hasta un
 * espacio— y un hash desactualizado no falla en el build: falla en el navegador
 * del operador.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');

// Sólo los <script> SIN atributo src: son los que la CSP evalúa por hash.
const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

const hashes = inline.map(
  (cuerpo) => `'sha256-${createHash('sha256').update(cuerpo, 'utf8').digest('base64')}'`,
);

writeFileSync('csp-script-hashes.txt', hashes.join(' '));
console.log(`Scripts inline encontrados: ${inline.length} -> ${hashes.join(' ') || '(ninguno)'}`);
