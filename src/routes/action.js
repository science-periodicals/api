import { Router } from 'express';
import bodyParser from 'body-parser';
import createError from '@scipe/create-error';
import { contextLink } from '@scipe/jsonld';
import { addLibrarian, parseQuery, acl } from '../middlewares/librarian';
import { cache, uncache } from '../utils/cache-utils';

const jsonParser = bodyParser.json({
  limit: '100mb',
  type: ['application/json', 'application/*+json']
});
const router = new Router({ caseSensitive: true });

/**
 * Get an action by id
 */
router.get('/:actionId', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      req.librarian.get(
        `action:${req.params.actionId}`,
        {
          acl: req.app.locals.config.acl,
          potentialActions: req.query.potentialActions,
          anonymize: req.app.locals.config.anonymize
        },
        callback
      );
    },
    (err, payload) => {
      if (err) return next(err);
      res.set('Link', contextLink);
      res.send(payload);
    }
  );
});

/**
 * Search for actions
 */
router.get('/', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      req.librarian.search(
        'action',
        req.query,
        {
          acl: req.app.locals.config.acl,
          baseUrl: `${req.protocol}://${req.headers.host}${req.baseUrl}${
            req.path
          }`,
          anonymize: req.app.locals.config.anonymize
        },
        callback
      );
    },
    (err, payload) => {
      if (err) {
        return next(err);
      }
      res.set('Link', contextLink);
      res.send(payload);
    }
  );
});

/**
 * Note that we can only delete certain types of action (see librarian);
 */
router.delete(
  '/:actionId',
  addLibrarian,
  parseQuery,
  acl(),
  (req, res, next) => {
    req.librarian.delete(
      `action:${req.params.actionId}`,
      {
        acl: req.app.locals.config.acl,
        anonymize: req.app.locals.config.anonymize
      },
      (err, deleted) => {
        if (err) return next(err);
        res.set('Link', contextLink);
        res.json(deleted);

        uncache(req, deleted, err => {
          if (err) {
            req.log.error(
              { err, deleted, url: req.originalUrl },
              `error invalidating cache`
            );
          }
        });
      }
    );
  }
);

/**
 * Note: we do not use the acl() middleware as this needs to work for RegisterAction
 */
router.post('/', addLibrarian, parseQuery, jsonParser, (req, res, next) => {
  // POST /action can be used for search if req.body has a `query`, `q`, `ranges` our `counts` parameter
  if (
    req.body &&
    (req.body.query || req.body.q || req.body.ranges || req.body.counts)
  ) {
    cache(
      req,
      callback => {
        req.librarian.search(
          'action',
          req.body,
          {
            acl: req.app.locals.config.acl,
            baseUrl: `${req.protocol}://${req.headers.host}${req.baseUrl}${
              req.path
            }`,
            anonymize: req.app.locals.config.anonymize
          },
          callback
        );
      },
      (err, payload) => {
        if (err) {
          return next(err);
        }
        res.set('Link', contextLink);
        res.send(payload);
      }
    );
    return;
  }

  // Normal case

  const contentLength = parseInt(req.get('Content-Length'), 10);

  if (contentLength === 0) {
    return next(createError(400, 'Missing body'));
  }

  // check Content-Type
  if (!req.is('application/json') && !req.is('application/ld+json')) {
    return next(
      createError(
        415,
        'Unsupported Media Type: please post a JSON or JSON-LD payload'
      )
    );
  }

  // Restrict RegisterAction
  if (req.body['@type'] === 'RegisterAction') {
    if (!req.app.locals.openRegistration) {
      return next(
        createError(
          401,
          'sci.pe is currently in limited preview and requires an invitation to sign up.'
        )
      );
    }
  }

  req.librarian.post(
    req.body,
    {
      acl: req.app.locals.config.acl,
      mode: req.query.mode,
      createCertificate: req.query.createCertificate, // mostly usefull for debugging purpose
      anonymize: req.app.locals.config.anonymize,
      referer: req.headers.referer // used for emails
    },
    (err, action) => {
      if (err) return next(err);
      const statusCode =
        [
          'DocumentProcessingAction',
          'ImageProcessingAction',
          'AudioVideoProcessingAction'
        ].includes(action['@type']) &&
        (!action.actionStatus ||
          action.actionStatus === 'PotentialActionStatus' ||
          action.actionStatus === 'ActiveActionStatus')
          ? 202
          : 200;
      res.set('Link', contextLink);
      res.status(statusCode).json(action);

      uncache(req, action, err => {
        if (err) {
          req.log.error(
            { err, action, url: req.originalUrl },
            `error invalidating cache`
          );
        }
      });
    }
  );
});

export default router;
