jest.mock('dotenv', () => ({ config: jest.fn() }));
const previous = { ...process.env };
afterEach(() => {
  process.env = { ...previous };
});
test.each([
  ['development', 0],
  ['test', 0],
  ['production', 1],
])('trust proxy %s default %i', (nodeEnv, expected) => {
  process.env.NODE_ENV = nodeEnv;
  delete process.env.TRUST_PROXY_HOPS;
  if (nodeEnv === 'production') process.env.CAPTCHA_PROVIDER = 'turnstile';
  jest.isolateModules(() => {
    expect(jest.requireActual('../../src/config/env').env.TRUST_PROXY_HOPS).toBe(expected);
  });
});
