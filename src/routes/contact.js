import { Router } from 'express';
import createError from '@scipe/create-error';
import { contextLink } from '@scipe/jsonld';
import { addLibrarian, parseQuery } from '../middlewares/librarian';

const router = new Router({ caseSensitive: true });

// Note: we currently do not cache contact routes as the gain is minimal

/**
 * Get a contact point by @id
 */
router.get('/:contactPointId', addLibrarian, parseQuery, (req, res, next) => {
  req.librarian.get(
    `contact:${req.params.contactPointId}`,
    {
      acl: req.app.locals.config.acl,
      potentialActions: req.query.potentialActions,
      anonymize: req.app.locals.config.anonymize
    },
    (err, doc) => {
      if (err) return next(err);
      res.set('Link', contextLink);
      res.json(doc);
    }
  );
});

/**
 * Validate a contact point (click validate from email)
 * Need:
 * - action qs
 * - token qs
 * - next qs
 */
router.get(
  '/:contactPointId/validate',
  addLibrarian,
  parseQuery,
  (req, res, next) => {
    if (!req.query.token || !req.query.action || !req.query.next) {
      return next(
        createError(
          400,
          'Invalid query string parameters, need valid `token`, `action` and `next` parameters'
        )
      );
    }
    if (req.query.next.includes(req.originalUrl.split('?')[0])) {
      return next(
        createError(
          400,
          `Invalid query string parameters next, next cannot include ${
            req.originalUrl.split('?')[0]
          }`
        )
      );
    }

    const token = {
      '@type': 'Token',
      tokenType: 'emailVerificationToken',
      value: req.query.token,
      instrumentOf: `action:${req.query.action}`
    };

    req.librarian.validateContactPointEmail(
      `contact:${req.params.contactPointId}`,
      token,
      { mode: req.query.mode },
      (err, contactPoint) => {
        if (err) return next(err);
        res.redirect(303, req.query.next);
      }
    );
  }
);

export default router;
