import path from 'path';
import express from 'express';
import BlobStore from '@scipe/blob-store';
import { createRedisClient } from '@scipe/librarian';
import contextRoutes from './routes/context';
import userRoutes from './routes/user';
import organizationRoutes from './routes/organization';
import periodicalRoutes from './routes/periodical';
import actionRoutes from './routes/action';
import graphRoutes from './routes/graph';
import nodeRoutes from './routes/node';
import roleRoutes from './routes/role';
import contactRoutes from './routes/contact';
import workflowRoutes from './routes/workflow';
import serviceRoutes from './routes/service';
import typeRoutes from './routes/type';
import issueRoutes from './routes/issue';
import feedRoutes from './routes/feed';
import stripeRoutes from './routes/stripe';
import invoiceRoutes from './routes/invoice';

import encodingRoutes from './routes/encoding';
import loadRoutes from './routes/load';

import createProxy from './middlewares/create-proxy';
import createRateLimiter from './middlewares/create-rate-limiter';
import error from './middlewares/error';
import { validateBasicAuthCredentials } from './middlewares/librarian';
export { default as error } from './middlewares/error';
export { default as createProxy } from './middlewares/create-proxy';
export {
  default as createRateLimiter
} from './middlewares/create-rate-limiter';
export * from './middlewares/librarian';

export function assets(config = {}) {
  const expressStatic = express.static(
    path.join(path.dirname(__dirname), 'public')
  );

  return expressStatic;
}

export function api(config = {}) {
  const app = express();

  app.enable('case sensitive routing');

  // we append the config with redis, blobStore and worker so that when we use the changes feed it
  // has access to those without having to recreate them!
  app.locals.config = Object.assign(
    {
      acl: true, // mostly used for dev purpose to disable acl
      cache: false,
      anonymize:
        config.anonymize != null
          ? config.anonymize
          : process.env.ANONYMIZE != null
          ? process.env.ANONYMIZE
          : true,
      // default values are for dev mode
      stripeSaWebhookSecret:
        config.stripeSaWebhookSecret ||
        process.env.STRIPE_SA_WEBHOOK_SECRET ||
        'whsec_sa',
      stripeConnectWebhookSecret:
        config.stripeConnectWebhookSecret ||
        process.env.STRIPE_CONNECT_WEBHOOK_SECRET ||
        'whsec_connect'
    },
    config,
    config.redis ? undefined : { redis: createRedisClient(config) },
    config.blobStore ? undefined : { blobStore: new BlobStore(config) }
  );

  app.locals.DB_VERSION = app.locals.config.dbVersion || '';

  app.locals.openRegistration = app.locals.config.openRegistration;

  // we re-use the `rateLimiter` passed in config when possible
  const rateLimiter =
    app.locals.config.rateLimiter || createRateLimiter(app.locals.config);
  const errMiddleware = error(app.locals.config);
  const proxy = createProxy(app.locals.config);

  app.use(proxy);

  app.use(
    '/',
    rateLimiter,
    validateBasicAuthCredentials,
    contextRoutes,
    errMiddleware
  );

  app.use(
    '/service',
    rateLimiter,
    validateBasicAuthCredentials,
    serviceRoutes,
    errMiddleware
  );

  app.use(
    '/user',
    rateLimiter,
    validateBasicAuthCredentials,
    userRoutes,
    errMiddleware
  );

  app.use(
    '/organization',
    rateLimiter,
    validateBasicAuthCredentials,
    organizationRoutes,
    errMiddleware
  );

  app.use(
    '/periodical',
    rateLimiter,
    validateBasicAuthCredentials,
    periodicalRoutes,
    errMiddleware
  );

  app.use(
    '/graph',
    rateLimiter,
    validateBasicAuthCredentials,
    graphRoutes,
    errMiddleware
  );

  app.use(
    '/node',
    rateLimiter,
    validateBasicAuthCredentials,
    nodeRoutes,
    errMiddleware
  );

  app.use(
    '/role',
    rateLimiter,
    validateBasicAuthCredentials,
    roleRoutes,
    errMiddleware
  );

  app.use(
    '/contact',
    rateLimiter,
    validateBasicAuthCredentials,
    contactRoutes,
    errMiddleware
  );

  app.use(
    '/workflow',
    rateLimiter,
    validateBasicAuthCredentials,
    workflowRoutes,
    errMiddleware
  );

  app.use(
    '/action',
    rateLimiter,
    validateBasicAuthCredentials,
    actionRoutes,
    errMiddleware
  );

  app.use(
    '/type',
    rateLimiter,
    validateBasicAuthCredentials,
    typeRoutes,
    errMiddleware
  );

  app.use(
    '/issue',
    rateLimiter,
    validateBasicAuthCredentials,
    issueRoutes,
    errMiddleware
  );

  app.use(
    '/feed',
    rateLimiter,
    validateBasicAuthCredentials,
    feedRoutes,
    errMiddleware
  );

  app.use(
    '/encoding',
    rateLimiter,
    validateBasicAuthCredentials,
    encodingRoutes,
    errMiddleware
  );

  app.use(
    '/load',
    rateLimiter,
    validateBasicAuthCredentials,
    loadRoutes,
    errMiddleware
  );

  app.use(
    '/stripe',
    rateLimiter,
    validateBasicAuthCredentials,
    stripeRoutes,
    errMiddleware
  );

  app.use(
    '/invoice',
    rateLimiter,
    validateBasicAuthCredentials,
    invoiceRoutes,
    errMiddleware
  );

  return app;
}
