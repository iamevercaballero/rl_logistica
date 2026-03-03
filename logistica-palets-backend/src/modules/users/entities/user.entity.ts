import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export type UserRole = 'ADMIN' | 'MANAGER' | 'OPERATOR' | 'AUDITOR';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'varchar', default: 'OPERATOR' })
  role: UserRole;

  @Column({ default: true })
  active: boolean;
}
