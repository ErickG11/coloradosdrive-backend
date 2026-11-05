import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { PAYMENT_VAT_CENTS, type PaymentConfig } from '../config/paymentConfig';
import type { PaymentRow, StudentPayment } from '../models/studentPayment.model';
import { AppError } from '../utils/AppError';
import { throwStudentPaymentError } from '../utils/studentPaymentError';
import { expireStudentSchedule } from './studentScheduleExpiry.service';
import { KushkiPaymentProvider } from './payments/kushkiProvider';
import {
  ManualPaymentProvider,
  SimulatedPaymentProvider,
  type ProviderResult,
} from './payments/paymentProvider';
type Db = SupabaseClient<Database>;
export function paymentDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function paymentView(p: PaymentRow): StudentPayment {
  return {
    id: p.id,
    reservationId: p.reservation_id,
    enrollmentId: p.enrollment_id,
    proveedor: p.proveedor,
    estado: p.estado,
    subtotalCentavos: p.subtotal_centavos,
    recargoCentavos: p.recargo_centavos,
    ivaCentavos: p.iva_centavos,
    totalCentavos: p.total_centavos,
    moneda: p.moneda,
    createdAt: p.created_at,
    confirmedAt: p.confirmed_at,
    serverNow: new Date().toISOString(),
    requiereRevision: p.estado === 'revision',
  };
}
export class StudentPaymentService {
  constructor(
    private readonly db: Db,
    private readonly config: PaymentConfig & { PAGO_GRACIA_MINUTES: number },
  ) {}
  async own(studentId: string, id: string): Promise<PaymentRow> {
    const result = await this.db
      .from('payments')
      .select()
      .eq('id', id)
      .eq('student_id', studentId)
      .maybeSingle();
    if (result.error) throwStudentPaymentError(result.error);
    if (!result.data)
      throw new AppError('Pago no encontrado.', 404, { code: 'PAGO_NO_ENCONTRADO' });
    return result.data;
  }
  async current(studentId: string): Promise<StudentPayment | null> {
    const result = await this.db
      .from('payments')
      .select()
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(1)
      .maybeSingle();
    if (result.error) throwStudentPaymentError(result.error);
    return result.data ? paymentView(result.data) : null;
  }
  async begin(
    studentId: string,
    reservationId: string,
    attempt: string,
    admin?: { id: string; comprobante?: string },
  ): Promise<StudentPayment> {
    if (!admin && this.config.PAYMENT_PROVIDER === 'manual')
      throw new AppError('El pago en efectivo lo registra la escuela.', 409, {
        code: 'PAGO_EN_ESCUELA',
      });
    await expireStudentSchedule(this.db, studentId);
    const result = await this.db.rpc('begin_student_payment', {
      p_student: studentId,
      p_reserva: reservationId,
      p_proveedor: admin ? 'manual' : this.config.PAYMENT_PROVIDER,
      p_attempt: attempt,
      p_recargo: this.config.PAYMENT_SURCHARGE_CENTS,
      p_gracia: this.config.PAGO_GRACIA_MINUTES,
      ...(admin
        ? { p_actor: admin.id, ...(admin.comprobante ? { p_comprobante: admin.comprobante } : {}) }
        : {}),
    });
    if (result.error) throwStudentPaymentError(result.error);
    return result.data;
  }
  async quote(
    studentId: string,
    reservationId: string,
  ): Promise<{
    subtotalCentavos: number;
    recargoCentavos: number;
    ivaCentavos: number;
    totalCentavos: number;
    moneda: 'USD';
  }> {
    await expireStudentSchedule(this.db, studentId);
    const r = await this.db
      .from('student_schedule_reservations')
      .select('cohort_id,estado')
      .eq('id', reservationId)
      .eq('student_id', studentId)
      .maybeSingle();
    if (r.error) throwStudentPaymentError(r.error);
    if (!r.data || !['vigente', 'pago_en_curso'].includes(r.data.estado))
      throw new AppError('Reserva vencida o no encontrada.', 409, { code: 'RESERVA_VENCIDA' });
    const cohort = await this.db
      .from('cohorts')
      .select('precio')
      .eq('id', r.data.cohort_id)
      .single();
    if (cohort.error) throwStudentPaymentError(cohort.error);
    const subtotalCentavos = Math.round(Number(cohort.data.precio) * 100);
    return {
      subtotalCentavos,
      recargoCentavos: this.config.PAYMENT_SURCHARGE_CENTS,
      ivaCentavos: PAYMENT_VAT_CENTS,
      totalCentavos: subtotalCentavos + this.config.PAYMENT_SURCHARGE_CENTS,
      moneda: 'USD',
    };
  }
  private async record(
    payment: PaymentRow,
    result: ProviderResult,
    reference: string,
  ): Promise<StudentPayment> {
    const canonical = JSON.stringify({
      paymentId: payment.id,
      resultado: result,
      total: payment.total_centavos,
      moneda: payment.moneda,
      referencia: reference,
    });
    const response = await this.db.rpc('confirm_student_payment', {
      p_id: payment.id,
      p_proveedor: payment.proveedor,
      p_referencia: reference,
      p_resultado: result,
      p_total: payment.total_centavos,
      p_moneda: payment.moneda,
      p_event: paymentDigest(canonical),
      p_hash: paymentDigest(canonical),
    });
    if (response.error) throwStudentPaymentError(response.error);
    return response.data;
  }
  async simulate(studentId: string, id: string, result: ProviderResult): Promise<StudentPayment> {
    if (this.config.PAYMENT_PROVIDER !== 'simulado')
      throw new AppError('El checkout simulado está deshabilitado.', 403, {
        code: 'SIMULACION_DESHABILITADA',
      });
    const payment = await this.own(studentId, id);
    if (payment.proveedor !== 'simulado')
      throw new AppError('Este pago no es simulado.', 403, { code: 'PAGO_NO_PERMITIDO' });
    if (payment.estado !== 'pendiente') return paymentView(payment);
    const outcome = await new SimulatedPaymentProvider().charge(paymentView(payment), {
      resultado: result,
    });
    return this.record(payment, outcome.resultado, outcome.referencia ?? `sim-${payment.id}`);
  }
  async cash(
    actor: string,
    student: string,
    reservation: string,
    attempt: string,
    comprobante?: string,
  ): Promise<StudentPayment> {
    const payment = await this.begin(student, reservation, attempt, { id: actor, comprobante });
    if (payment.estado !== 'pendiente') return payment;
    const row = await this.own(student, payment.id);
    const outcome = await new ManualPaymentProvider().charge(payment);
    return this.record(row, outcome.resultado, outcome.referencia ?? `cash-${payment.id}`);
  }
  async charge(studentId: string, id: string, token: string): Promise<StudentPayment> {
    const row = await this.own(studentId, id);
    if (this.config.PAYMENT_PROVIDER !== 'kushki' || row.proveedor !== 'kushki')
      throw new AppError('El pago con tarjeta está deshabilitado.', 403, {
        code: 'TARJETA_DESHABILITADA',
      });
    if (row.estado !== 'pendiente') return paymentView(row);
    // Preparar contacto ANTES de reclamar dispatch: un fallo local aún permite reintentar.
    const [profile, user] = await Promise.all([
      this.db
        .from('solicitudes_inscripcion')
        .select('cedula,nombres,apellidos,telefono')
        .eq('student_id', studentId)
        .eq('estado', 'aprobada')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      this.db.auth.admin.getUserById(studentId),
    ]);
    if (
      profile.error ||
      user.error ||
      !profile.data?.cedula ||
      !profile.data.nombres ||
      !profile.data.apellidos ||
      !user.data.user.email
    )
      throw new AppError(
        'No pudimos preparar el pago. Consulta tu estado antes de reintentar.',
        503,
        { code: 'PAGO_NO_DISPONIBLE' },
      );
    const claim = await this.db.rpc('claim_payment_dispatch', { p_id: row.id });
    if (claim.error) throwStudentPaymentError(claim.error);
    if (!claim.data) return paymentView(await this.own(studentId, id));
    const outcome = await new KushkiPaymentProvider(this.config).charge(paymentView(row), {
      token,
      contact: {
        cedula: profile.data.cedula,
        nombres: profile.data.nombres,
        apellidos: profile.data.apellidos,
        correo: user.data.user.email,
        ...(profile.data.telefono ? { telefono: profile.data.telefono } : {}),
      },
    });
    if (outcome.referencia) {
      const reference = await this.db.rpc('record_payment_reference', {
        p_id: row.id,
        p_proveedor: 'kushki',
        p_referencia: outcome.referencia,
      });
      if (reference.error) throwStudentPaymentError(reference.error);
    }
    return paymentView(await this.own(studentId, id));
  }
  async release(actor: string, reservation: string): Promise<void> {
    const result = await this.db.rpc('admin_release_student_reservation', {
      p_actor: actor,
      p_reserva: reservation,
    });
    if (result.error) throwStudentPaymentError(result.error);
  }
}
