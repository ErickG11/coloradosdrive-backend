export type CourseType = 'A' | 'B';

export interface Course {
  id: string;
  nombre: string;
  tipo: CourseType;
  descripcion: string | null;
  createdAt: string;
  updatedAt: string;
}
