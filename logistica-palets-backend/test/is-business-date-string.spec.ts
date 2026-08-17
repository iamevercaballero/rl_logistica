import { IsOptional } from 'class-validator';
import { validate } from 'class-validator';
import { IsBusinessDateString } from '../src/common/is-business-date-string.validator';

class Fixture {
  @IsOptional()
  @IsBusinessDateString()
  fecha?: string;
}

describe('@IsBusinessDateString — fecha calendario estricta en DTOs', () => {
  it('acepta YYYY-MM-DD', async () => {
    const f = new Fixture();
    f.fecha = '2027-08-15';
    expect(await validate(f)).toHaveLength(0);
  });

  it('rechaza un instante completo — a diferencia de @IsDateString()', async () => {
    const f = new Fixture();
    f.fecha = '2027-08-15T14:30:00.000Z';
    const errors = await validate(f);
    expect(errors).toHaveLength(1);
  });

  it('rechaza DD/MM/AAAA (el formato de Excel, no el que espera la API)', async () => {
    const f = new Fixture();
    f.fecha = '15/08/2027';
    expect(await validate(f)).toHaveLength(1);
  });

  it('undefined pasa (el campo es @IsOptional())', async () => {
    const f = new Fixture();
    expect(await validate(f)).toHaveLength(0);
  });
});
