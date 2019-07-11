import { Router } from 'express';
import createError from '@scipe/create-error';
import { contextLink } from '@scipe/jsonld';
import { addLibrarian, parseQuery, acl } from '../middlewares/librarian';

const router = new Router({ caseSensitive: true });

// Note: we currently do not cache user routes as we don't have a good concept of
// "scope" for those yet

/**
 * Get user by @id
 * qs:
 * - `addActiveRoles`: used by app-suite to control the changes feed (needs acl)
 */
router.get('/:userId', addLibrarian, parseQuery, (req, res, next) => {
  req.librarian.get(
    `user:${req.params.userId}`,
    {
      acl: req.app.locals.config.acl,
      anonymize: req.app.locals.config.anonymize
    },
    (err, user) => {
      if (err) return next(err);

      if (!req.query.includeActiveRoles) {
        res.set('Link', contextLink);
        res.json(user);
      } else {
        // `includeActiveRoles` case
        acl()(req, res, err => {
          if (err) return next(err);

          if (req.params.userId !== req.username) {
            return next(
              createError(
                403,
                `includeActiveRoles can only be used for the logged in user (${req.username} instead of ${req.params.userId})`
              )
            );
          }

          req.librarian.getActiveGraphRoleIdsByUserId(
            req.userId,
            (err, roleIds) => {
              if (err) return next(err);
              res.set('Link', contextLink);
              res.json(Object.assign(user, { hasActiveRole: roleIds }));
            }
          );
        });
      }
    }
  );
});

/**
 * Search for users
 */
router.get('/', addLibrarian, parseQuery, (req, res, next) => {
  req.librarian.search(
    'profile',
    req.query,
    {
      acl: req.app.locals.config.acl,
      baseUrl: `${req.protocol}://${req.headers.host}${req.baseUrl}${req.path}`,
      anonymize: req.app.locals.config.anonymize
    },
    (err, itemList) => {
      if (err) {
        return next(err);
      }
      res.set('Link', contextLink);
      res.json(itemList);
    }
  );
});

export default router;
