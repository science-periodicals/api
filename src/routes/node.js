import { Router } from 'express';
import { contextLink } from '@scipe/jsonld';
import { addLibrarian, parseQuery } from '../middlewares/librarian';

const router = new Router({ caseSensitive: true });

// Note: we currently do not cache node routes as we don't have a good concept of
// "scope" for those yet

/**
 * Get a node by @id
 */
router.get('/:nodeId', addLibrarian, parseQuery, (req, res, next) => {
  req.librarian.get(
    `node:${req.params.nodeId}`,
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

export default router;
