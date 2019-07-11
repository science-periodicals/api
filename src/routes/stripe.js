import { Router } from 'express';
import bodyParser from 'body-parser';
import { getId, unprefix, contextLink } from '@scipe/jsonld';
import createError from '@scipe/create-error';
import { addLibrarian, parseQuery } from '../middlewares/librarian';

const jsonParser = bodyParser.json({
  limit: '100mb',
  type: ['application/json', 'application/*+json']
});

const router = new Router({ caseSensitive: true });

/**
 * Get an account given an organization @id (specified as an organization query string parameter)
 */
router.get('/account', parseQuery, addLibrarian, (req, res, next) => {
  if (!req.query.organization) {
    return next(
      createError(400, 'missing organization query string parameter')
    );
  }

  const organizationId = `org:${req.query.organization}`;

  req.librarian.checkAcl(
    {
      docs: [organizationId]
    },
    (err, check) => {
      if (err) return next(err);
      if (!check.isAdmin && !check([organizationId, 'AdminPermission'])) {
        return next(createError(403, 'not allowed'));
      }

      req.librarian.getStripeAccountByOrganizationId(
        organizationId,
        (err, account) => {
          if (err) return next(err);

          res.json(account);
        }
      );
    }
  );
});

/**
 * Get a customer given an organization @id (specified as an organization query string parameter)
 */
router.get('/customer', parseQuery, addLibrarian, (req, res, next) => {
  if (!req.query.organization) {
    return next(
      createError(400, 'missing organization query string parameter')
    );
  }

  const organizationId = `org:${req.query.organization}`;

  req.librarian.checkAcl(
    {
      docs: [organizationId]
    },
    (err, check) => {
      if (err) return next(err);
      if (!check.isAdmin && !check([organizationId, 'AdminPermission'])) {
        return next(createError(403, 'not allowed'));
      }

      req.librarian.getStripeCustomerByOrganizationId(
        organizationId,
        (err, account) => {
          if (err) return next(err);

          res.json(account);
        }
      );
    }
  );
});

/**
 * Get an active `SubscribeAction` given an organization @id (specified as an organization query string parameter)
 */
router.get('/subscription', parseQuery, addLibrarian, (req, res, next) => {
  if (!req.query.organization) {
    return next(
      createError(400, 'missing organization query string parameter')
    );
  }

  const organizationId = `org:${req.query.organization}`;

  req.librarian.checkAcl(
    {
      docs: [organizationId]
    },
    (err, check) => {
      if (err) return next(err);
      if (!check.isAdmin && !check([organizationId, 'AdminPermission'])) {
        return next(createError(403, 'not allowed'));
      }

      req.librarian.getActiveSubscribeAction(
        organizationId,
        (err, subscribeAction) => {
          if (err) return next(err);

          res.set('Link', contextLink);
          res.send(subscribeAction);
        }
      );
    }
  );
});

/**
 * This is mostly used so that stripe: CURIE can be dereferenced
 */
router.get('/:stripeId', addLibrarian, (req, res, next) => {
  req.librarian.getStripeObject(req.params.stripeId, (err, object) => {
    if (err) return next(err);
    const organizationId = getId(object.metadata.organization);
    req.librarian.checkAcl(
      {
        docs: [organizationId]
      },
      (err, check) => {
        if (err) return next(err);

        if (!check.isAdmin && !check([organizationId, 'AdminPermission'])) {
          return next(createError(403, 'not allowed'));
        }

        res.json(object);
      }
    );
  });
});

/**
 * Webhooks
 */
router.post(
  '/stripe/:type(sa|connect)',
  addLibrarian,
  jsonParser,
  (req, res, next) => {
    const signature = req.headers['stripe-signature'];

    try {
      var event = req.librarian.stripe.webhooks.constructEvent(
        req.body,
        signature,
        req.app.locals.config[
          req.params.type === 'sa'
            ? 'stripeSaWebhookSecret'
            : 'stripeConnectWebhookSecret'
        ]
      );
    } catch (err) {
      res.status(400).end();
    }

    req.librarian.handleStripeEvent(event, (err, statusCode) => {
      if (err) return next(err);
      res.status(statusCode).json({ ok: true });
    });
  }
);

export default router;
