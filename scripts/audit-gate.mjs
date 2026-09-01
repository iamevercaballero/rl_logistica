#!/usr/bin/env node
/**
 * Compuerta de auditoría de dependencias para el CI.
 *
 *   node ../scripts/audit-gate.mjs        (desde logistica-palets-backend o -frontend)
 *
 * Falla si aparece cualquier vulnerabilidad alta o crítica en las dependencias
 * que se despliegan, EXCEPTO las que están listadas abajo con su motivo.
 *
 * Por qué no alcanza `npm audit --audit-level=high --omit=dev` a secas: tarde o
 * temprano aparece una vulnerabilidad sin parche publicado (fue el caso de
 * `xlsx` hasta que se lo reemplazó por exceljs). Con el comando pelado el CI
 * quedaría rojo hasta que exista el parche, y un CI que siempre está rojo no
 * avisa de nada — el equipo aprende a ignorarlo y la próxima vulnerabilidad
 * real pasa desapercibida. Bajar el umbral a `critical` sería peor: dejaría de
 * mirar justo la categoría donde caen casi todas.
 *
 * Hoy no hay ninguna excepción activa, que es el estado deseado.
 *
 * La lista de excepciones es la parte importante: cada una tiene que decir por
 * qué se acepta y qué la saca de acá. Si una excepción no se puede justificar en
 * dos líneas, no es una excepción, es deuda que hay que pagar.
 */

import { execSync } from 'node:child_process';

/**
 * Vulnerabilidades aceptadas a conciencia, por proyecto.
 *
 * Van acotadas al proyecto que las tiene: una excepción del backend no debe
 * contarse como "obsoleta" al correr en el frontend, que simplemente no usa ese
 * paquete.
 */
const EXCEPCIONES_POR_PROYECTO = {
  'logistica-palets-backend': {},
  'logistica-palets-frontend': {},
};

const proyecto = process.cwd().split(/[\\/]/).pop();

if (!(proyecto in EXCEPCIONES_POR_PROYECTO)) {
  console.error(
    `[${proyecto}] no está declarado en audit-gate.mjs. Agregalo (aunque sea con {}) ` +
      'para que sus excepciones queden explícitas en vez de heredadas por descuido.',
  );
  process.exit(1);
}
const EXCEPCIONES = EXCEPCIONES_POR_PROYECTO[proyecto];

let reporte;
try {
  // `npm audit` sale con código != 0 cuando encuentra algo: se captura la salida
  // igual, porque el JSON es lo que hay que analizar.
  reporte = execSync('npm audit --json --omit=dev', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch (error) {
  reporte = error.stdout;
}

if (!reporte) {
  console.error(`[${proyecto}] npm audit no devolvió salida analizable.`);
  process.exit(1);
}

const { vulnerabilities = {} } = JSON.parse(reporte);
const graves = Object.entries(vulnerabilities).filter(([, v]) =>
  ['high', 'critical'].includes(v.severity),
);

const bloqueantes = graves.filter(([nombre]) => !(nombre in EXCEPCIONES));
const aceptadas = graves.filter(([nombre]) => nombre in EXCEPCIONES);

console.log(`[${proyecto}] auditoría de dependencias de producción`);

if (aceptadas.length > 0) {
  console.log('\nAceptadas a conciencia:');
  for (const [nombre, v] of aceptadas) {
    console.log(`  - ${nombre} (${v.severity})`);
    console.log(`      ${EXCEPCIONES[nombre].motivo}`);
    console.log(`      Se saca cuando: ${EXCEPCIONES[nombre].revisar}`);
  }
}

// Una excepción que ya no hace falta es tan mala como una que falta: obliga a
// mantener la lista al día en vez de dejarla crecer con entradas muertas.
const obsoletas = Object.keys(EXCEPCIONES).filter((nombre) => !graves.some(([n]) => n === nombre));
if (obsoletas.length > 0) {
  console.log(`\nExcepciones que ya no aplican (sacalas de audit-gate.mjs): ${obsoletas.join(', ')}`);
}

if (bloqueantes.length === 0) {
  console.log('\nSin vulnerabilidades altas o críticas fuera de las aceptadas.');
  process.exit(0);
}

console.error('\nVulnerabilidades que bloquean el build:');
for (const [nombre, v] of bloqueantes) {
  const parche = v.fixAvailable === false ? 'sin parche' : 'hay parche disponible';
  console.error(`  - ${nombre} (${v.severity}) — ${parche}`);
  for (const via of v.via) {
    if (typeof via === 'object' && via.title) console.error(`      ${via.title}`);
  }
}
console.error('\nCorregilas con `npm audit fix`, o agregá una excepción justificada en scripts/audit-gate.mjs.');
process.exit(1);
