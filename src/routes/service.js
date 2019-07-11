import { Router } from 'express';
import bodyParser from 'body-parser';
import { contextLink } from '@scipe/jsonld';
import { addLibrarian, parseQuery } from '../middlewares/librarian';
import { cache } from '../utils/cache-utils';

const jsonParser = bodyParser.json({
  limit: '100mb',
  type: ['application/json', 'application/*+json']
});

const router = new Router({ caseSensitive: true });

/**
 * Get a service by @id
 */
router.get('/:serviceId', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      const {
        params: { serviceId },
        query: { potentialActions } = {}
      } = req;

      req.librarian.get(
        `service:${serviceId}`,
        {
          acl: req.app.locals.config.acl,
          potentialActions,
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
 * Search for services
 */
router.get('/', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      const { query } = req;

      req.librarian.search(
        'service',
        query,
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
      if (err) return next(err);
      res.set('Link', contextLink);
      res.send(payload);
    }
  );
});

/**
 * Same as GET (used to allow user to search long string of text that would
 * create issue with URL length limits)
 */
router.post('/', addLibrarian, parseQuery, jsonParser, (req, res, next) => {
  cache(
    req,
    callback => {
      req.librarian.search(
        'service',
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
      if (err) return next(err);
      res.set('Link', contextLink);
      res.send(payload);
    }
  );
});

export default router;
