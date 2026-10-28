import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type {
  InstructorRatingDetail,
  InstructorRatingSummary,
  PracticeRatingPage,
  PracticeRatingPendingItem,
  PracticeRatingSubmission,
} from '../models/practiceRating.model';
import { throwPracticeRatingError } from '../utils/practiceRatingError';

export class PracticeRatingService {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async pending(
    studentId: string,
    page: number,
    pageSize: number,
  ): Promise<PracticeRatingPage<PracticeRatingPendingItem>> {
    const { data, error } = await this.db.rpc('list_student_pending_practice_ratings', {
      p_student: studentId,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throwPracticeRatingError(error, 'pending');
    return {
      page: data.page,
      pageSize: data.pageSize,
      total: data.total,
      items: data.items.map((item) => ({
        practiceSlotId: item.practiceSlotId,
        instructorName: item.instructorName,
        scheduledAt: item.scheduledAt,
        opensAt: item.opensAt,
        closesAt: item.closesAt,
      })),
    };
  }

  async submit(
    studentId: string,
    slotId: string,
    score: number,
    comment: string | null,
  ): Promise<PracticeRatingSubmission> {
    const { data, error } = await this.db.rpc('submit_practice_rating', {
      p_slot: slotId,
      p_student: studentId,
      p_score: score,
      p_comment: comment,
    });
    if (error) throwPracticeRatingError(error, 'submit');
    return {
      id: data.id,
      practiceSlotId: data.practiceSlotId,
      score: data.score,
      comment: data.comment,
      createdAt: data.createdAt,
    };
  }

  async ranking(
    actorId: string,
    page: number,
    pageSize: number,
  ): Promise<PracticeRatingPage<InstructorRatingSummary>> {
    const { data, error } = await this.db.rpc('list_admin_instructor_ratings', {
      p_actor: actorId,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throwPracticeRatingError(error, 'ranking');
    return {
      page: data.page,
      pageSize: data.pageSize,
      total: data.total,
      items: data.items.map((item) => ({
        instructorId: item.instructorId,
        instructorName: item.instructorName,
        active: item.active,
        average: item.average,
        responses: item.responses,
        rankingEligible: item.rankingEligible,
        label: item.label,
      })),
    };
  }

  async detail(
    actorId: string,
    instructorId: string,
    page: number,
    pageSize: number,
  ): Promise<InstructorRatingDetail> {
    const { data, error } = await this.db.rpc('admin_instructor_rating_detail', {
      p_actor: actorId,
      p_instructor: instructorId,
      p_page: page,
      p_page_size: pageSize,
    });
    if (error) throwPracticeRatingError(error, 'detail');
    return {
      instructorId: data.instructorId,
      average: data.average,
      responses: data.responses,
      rankingEligible: data.rankingEligible,
      label: data.label,
      items: data.items.map((item) => ({ score: item.score, comment: item.comment })),
      total: data.total,
      page: data.page,
      pageSize: data.pageSize,
    };
  }
}
