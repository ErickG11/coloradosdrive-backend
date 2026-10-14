jest.mock('../../src/app', () => ({ createApp: jest.fn(() => ({ listen: jest.fn() })) }));
jest.mock('../../src/jobs/practiceSlotCron', () => ({ startPracticeSlotCron: jest.fn() }));
jest.mock('../../src/jobs/solicitudCleanupCron', () => ({ startSolicitudCleanupCron: jest.fn() }));

describe('cron startup switch', () => {
  const previous = process.env.DISABLE_CRON;
  afterEach(() => {
    if (previous === undefined) delete process.env.DISABLE_CRON;
    else process.env.DISABLE_CRON = previous;
    jest.restoreAllMocks();
  });

  it.each([undefined, 'false'])('preserves cron startup with DISABLE_CRON=%s', (value) => {
    if (value === undefined) delete process.env.DISABLE_CRON;
    else process.env.DISABLE_CRON = value;
    jest.isolateModules(() => {
      jest.requireActual('../../src/index');
      const practice = jest.requireMock('../../src/jobs/practiceSlotCron');
      const cleanup = jest.requireMock('../../src/jobs/solicitudCleanupCron');
      expect(practice.startPracticeSlotCron).toHaveBeenCalledTimes(1);
      expect(cleanup.startSolicitudCleanupCron).toHaveBeenCalledTimes(1);
    });
  });

  it('disables both crons and logs the reason when true', () => {
    process.env.DISABLE_CRON = 'true';
    const log = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.isolateModules(() => {
      jest.requireActual('../../src/index');
      const practice = jest.requireMock('../../src/jobs/practiceSlotCron');
      const cleanup = jest.requireMock('../../src/jobs/solicitudCleanupCron');
      expect(practice.startPracticeSlotCron).not.toHaveBeenCalled();
      expect(cleanup.startSolicitudCleanupCron).not.toHaveBeenCalled();
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('DISABLE_CRON=true'));
  });
});
