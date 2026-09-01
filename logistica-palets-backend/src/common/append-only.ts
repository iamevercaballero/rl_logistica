import type { QueryRunner, DataSource } from 'typeorm';

/**
 * Tablas de auditoría que la base hace cumplir como append-only (RL-M-09).
 *
 * Hasta acá "append-only" era una convención escrita en un comentario: nada
 * impedía un `UPDATE` o un `DELETE` sobre la bitácora. En un sistema cuyo
 * propósito es sostener un inventario auditable, una bitácora que se puede
 * editar desde la misma conexión que la escribe no prueba gran cosa — quien
 * pueda hacer el movimiento indebido puede borrar su rastro.
 *
 * Se implementa con un trigger y no revocando privilegios porque el usuario de
 * la aplicación es dueño de las tablas: puede volver a otorgarse cualquier
 * permiso que se le revoque. El trigger, en cambio, se aplica a todo el mundo.
 *
 * `TRUNCATE` no dispara triggers de fila y sigue funcionando: es lo que usan
 * las pruebas para limpiar entre casos, y es una operación que requiere ser
 * dueño de la tabla, no algo que la aplicación haga en su operación normal.
 *
 * Para depurar o purgar a conciencia:
 *   ALTER TABLE "document_events" DISABLE TRIGGER "trg_document_events_append_only";
 *   -- ... la operación ...
 *   ALTER TABLE "document_events" ENABLE TRIGGER "trg_document_events_append_only";
 * Es deliberadamente incómodo: tiene que ser un acto consciente de quien
 * administra la base, no algo que pueda pasar por un bug de la aplicación.
 */
export const APPEND_ONLY_TABLES = ['document_events', 'user_audit_log', 'auth_events'] as const;

/** Nombre de la función que rechaza la modificación. */
export const APPEND_ONLY_FUNCTION = 'rl_reject_audit_mutation';

export function appendOnlyTriggerName(table: string): string {
  return `trg_${table}_append_only`;
}

/** SQL de la función. Idempotente: `CREATE OR REPLACE`. */
export const APPEND_ONLY_FUNCTION_SQL = `
  CREATE OR REPLACE FUNCTION "${APPEND_ONLY_FUNCTION}"() RETURNS trigger AS $$
  BEGIN
    RAISE EXCEPTION
      'La tabla % es append-only: % no está permitido. Es una bitácora de auditoría.',
      TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END;
  $$ LANGUAGE plpgsql;
`;

/**
 * Aplica la función y los triggers sobre las tablas que existan.
 *
 * Filtra por `information_schema` porque el esquema de las pruebas se arma con
 * el subconjunto de entidades que esa suite necesita, no con todas.
 */
export async function applyAppendOnlyTriggers(runner: QueryRunner | DataSource): Promise<void> {
  await runner.query(APPEND_ONLY_FUNCTION_SQL);

  for (const table of APPEND_ONLY_TABLES) {
    const existe = await runner.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`,
      [table],
    );
    if (existe.length === 0) continue;

    const trigger = appendOnlyTriggerName(table);
    await runner.query(`DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`);
    await runner.query(
      `CREATE TRIGGER "${trigger}"
       BEFORE UPDATE OR DELETE ON "${table}"
       FOR EACH ROW EXECUTE FUNCTION "${APPEND_ONLY_FUNCTION}"()`,
    );
  }
}

/** Quita los triggers y la función. Usado por el `down()` de la migración. */
export async function dropAppendOnlyTriggers(runner: QueryRunner | DataSource): Promise<void> {
  for (const table of APPEND_ONLY_TABLES) {
    await runner.query(`DROP TRIGGER IF EXISTS "${appendOnlyTriggerName(table)}" ON "${table}"`);
  }
  await runner.query(`DROP FUNCTION IF EXISTS "${APPEND_ONLY_FUNCTION}"()`);
}
