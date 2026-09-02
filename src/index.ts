import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

app.listen(env.PORT, () => {
  console.warn(`ColoradosDrive backend listening on port ${String(env.PORT)} (${env.NODE_ENV})`);
});
