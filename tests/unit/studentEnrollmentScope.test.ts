import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { activeCohortIds, activeCourseIds } from '../../src/services/studentEnrollmentScope';
import { createChain } from '../helpers/supabaseMock';
describe('Alcance de A+B para prácticas y exámenes', () => {
  it('reúne cohortes propias sin usar single y conserva filtro de activo', async () => {
    const chain = createChain({ data: [{ cohort_id: 'a' }, { cohort_id: 'b' }], error: null });
    const db = { from: jest.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>;
    expect(await activeCohortIds(db, 'student-own')).toEqual(['a', 'b']);
    expect(chain.eq).toHaveBeenCalledWith('student_id', 'student-own');
    expect(chain.eq).toHaveBeenCalledWith('status', 'activo');
    expect(chain.maybeSingle).not.toHaveBeenCalled();
  });
  it('los cursos proceden únicamente de esas cohortes', async () => {
    const enrolled = createChain({ data: [{ cohort_id: 'a' }, { cohort_id: 'b' }], error: null });
    const cohorts = createChain({
      data: [{ course_id: 'course-a' }, { course_id: 'course-b' }],
      error: null,
    });
    const from = jest.fn().mockReturnValueOnce(enrolled).mockReturnValueOnce(cohorts);
    expect(await activeCourseIds({ from } as unknown as SupabaseClient<Database>, 'own')).toEqual([
      'course-a',
      'course-b',
    ]);
    expect(cohorts.in).toHaveBeenCalledWith('id', ['a', 'b']);
  });
  it('no da acceso por un pendiente sin cohorte', async () => {
    const db = {
      from: jest.fn().mockReturnValue(createChain({ data: [], error: null })),
    } as unknown as SupabaseClient<Database>;
    expect(await activeCourseIds(db, 'own')).toEqual([]);
  });
});
