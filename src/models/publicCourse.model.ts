import type { CourseType } from './course.model';

// Representación deliberadamente mínima de un curso para la landing
// pública: sin cohortes, precios ni cupos. Se define por separado del
// `Course` admin (en vez de reutilizarlo) para que crecer ese modelo más
// adelante no filtre campos nuevos aquí sin una decisión explícita.
export interface PublicCourse {
  id: string;
  tipo: CourseType;
  nombre: string;
  horasRequeridas: number | null;
}
