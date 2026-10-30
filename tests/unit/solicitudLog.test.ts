import { logSolicitudFailure } from '../../src/utils/solicitudLog';
it('registra solo un código de evento y nunca detalles de una persona', () => {
 const log = jest.spyOn(console,'error').mockImplementation(() => undefined);
 logSolicitudFailure('verification_email_failed');
 expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({event:'verification_email_failed'});
 log.mockRestore();
});
