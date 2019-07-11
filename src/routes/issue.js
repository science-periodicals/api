import { Router } from 'express';
import bodyParser from 'body-parser';
import { contextLink } from '@scipe/jsonld';
import { addLibrarian, parseQuery, acl } from '../middlewares/librarian';
import { cache, uncache } from '../utils/cache-utils';

const jsonParser = bodyParser.json({
  limit: '100mb',
  type: ['application/json', 'application/*+json']
});

const router = new Router({ caseSensitive: true });

/**
 * Get an issue by @id
 */
router.get(
  '/:periodicalId/:issueId',
  addLibrarian,
  parseQuery,
  (req, res, next) => {
    cache(
      req,
      callback => {
        req.librarian.get(
          `issue:${req.params.periodicalId}/${req.params.issueId}`,
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
  }
);

/**
 * Delete an issue
 * Note that we can only delete certain types of PublicationIssue (see librarian);
 */
router.delete(
  '/:periodicalId/:issueId',
  addLibrarian,
  parseQuery,
  acl(),
  (req, res, next) => {
    req.librarian.delete(
      `issue:${req.params.periodicalId}/${req.params.issueId}`,
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
 * Search for issues
 */
router.get('/', addLibrarian, parseQuery, (req, res, next) => {
  cache(
    req,
    callback => {
      req.librarian.search(
        'issue',
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
        'issue',
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
