import http from 'http';
import {
  createExpressLoggerMiddleware,
  createExpressErrorLoggerMiddleware
} from '@scipe/express-logger';
import createError from '@scipe/create-error';
import express from 'express';
import { api, assets } from './';

const host = process.env.HOST || '127.0.0.1';
const port = process.env.PORT_HTTP || 3000;

const config = {
  openRegistration: true,
  log: { level: 'trace', name: 'api' }
};

const app = express();
app.use(assets(config));
app.use(createExpressLoggerMiddleware(config));
app.use(api(config));
app.get('/403', (req, res, next) => {
  return next(createError(403));
});
app.use(createExpressErrorLoggerMiddleware(config));

const server = http.createServer(app);
server.listen(port, () => {
  console.warn('Server running on port ' + port + ' (' + host + ')');
});
