import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Habilita `pg_stat_statements`.
 *
 * La auditoría lo marcaba como pendiente y era exacto: sin esto no hay forma de
 * saber qué consulta está costando el tiempo. Cuando el sistema esté lento, la
 * pregunta va a ser «¿cuál?», y hoy no habría con qué responderla — habría que
 * reproducirlo a mano, que es lo que se hizo para RL-A-07 armando un banco de un
 * millón de movimientos.
 *
 * **La librería tiene que estar precargada al arranque del servidor**
 * (`shared_preload_libraries`, ya puesto en los compose de dev, staging y
 * producción). Verificado en dos contenedores, con y sin la precarga, y el
 * comportamiento no es el que uno supondría: `CREATE EXTENSION` **funciona en
 * los dos casos**. Lo que falla, después y sólo al usarla, es consultar la
 * vista: `pg_stat_statements must be loaded via shared_preload_libraries`.
 *
 * O sea que esta migración no puede tumbar el arranque por esa causa. El
 * `EXCEPTION` queda igual, por otros motivos de fallo —permisos, sobre todo—:
 * son métricas de observabilidad, no una condición de corrección, y un sistema
 * que no levanta porque no pudo instalar su instrumental es peor que uno sin
 * instrumental. La contrapartida de que no falle es que, si alguien despliega
 * sin actualizar su compose, el problema aparece recién al consultar; por eso
 * está anotado en DEPLOY.md.
 *
 * Costo, medido y no estimado: `postgres:16-alpine` en reposo pasa de 30,4 MiB a
 * 41,8 MiB, unos **11 MB**, que es el 1 % del techo de 1 GB que RL-A-10 le fijó
 * a la base. La extensión guarda hasta `pg_stat_statements.max` consultas
 * normalizadas (5.000 por defecto); el texto va a un archivo aparte y en memoria
 * compartida quedan sólo las entradas de tamaño fijo.
 *
 * Qué hacer con esto una vez desplegado:
 *
 *   SELECT calls, round(mean_exec_time::numeric, 1) AS ms_prom,
 *          round(total_exec_time::numeric) AS ms_total, query
 *   FROM pg_stat_statements
 *   ORDER BY total_exec_time DESC LIMIT 20;
 *
 * Ordenar por `total_exec_time` y no por `mean_exec_time` es deliberado: la
 * consulta que más duele no suele ser la más lenta, sino una mediana que corre
 * miles de veces.
 */
export class EnablePgStatStatements1785300000000 implements MigrationInterface {
  name = 'EnablePgStatStatements1785300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING
          'pg_stat_statements no se pudo habilitar (%). El sistema funciona igual; sólo no habrá métricas de consultas. Revisá que shared_preload_libraries la incluya y reiniciá la base.',
          SQLERRM;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Simétrico y también tolerante: si nunca se creó, no hay nada que revertir.
    await queryRunner.query(`
      DO $$
      BEGIN
        DROP EXTENSION IF EXISTS pg_stat_statements;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'No se pudo quitar pg_stat_statements (%).', SQLERRM;
      END
      $$;
    `);
  }
}
