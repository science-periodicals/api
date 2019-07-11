import http from 'http';
import { api, error } from '../../src';
import express from 'express';
import { createExpressLoggerMiddleware } from '@scipe/express-logger';
import enableDestroy from 'server-destroy';

export default function(config) {
  const app = express();
  app.use(createExpressLoggerMiddleware({ log: { level: 'error' } }));
  app.use(api(config));
  app.use(error(config));
  const server = http.createServer(app);
  enableDestroy(server);

  return server;
}
